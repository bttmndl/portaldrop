import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import {
  createRoom,
  getRoom,
  deleteRoom,
  findRoomByDesktop,
  findRoomsByPhone,
  sweepExpiredRooms,
  roomCount,
} from './rooms.js';

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'portaldrop-server', rooms: roomCount() });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 12 * 1024 * 1024, // captured JPEGs travel as data URLs
});

io.on('connection', (socket) => {
  // ---- Desktop creates a room -------------------------------------------
  socket.on('room:create', (ack) => {
    if (typeof ack !== 'function') return;
    // One room per desktop socket — recreate replaces the old one.
    const existing = findRoomByDesktop(socket.id);
    if (existing) deleteRoom(existing.code);

    const room = createRoom(socket.id);
    socket.join(room.code);
    ack({ ok: true, code: room.code });
  });

  // ---- Phone joins via QR link ------------------------------------------
  socket.on('room:join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const room = getRoom(payload?.code);
    if (!room) {
      ack({ ok: false, error: 'not_found' });
      return;
    }
    socket.join(room.code);
    room.phones.add(socket.id);
    io.to(room.desktopId).emit('room:phone-connected', {
      phones: room.phones.size,
    });
    ack({ ok: true, code: room.code });
  });

  // ---- Phone throws an object through the portal -------------------------
  socket.on('object:transfer', (payload) => {
    const room = getRoom(payload?.code);
    if (!room || !room.phones.has(socket.id)) return;
    if (typeof payload.image !== 'string' || !payload.image.startsWith('data:image/')) return;

    io.to(room.desktopId).emit('object:incoming', {
      id: crypto.randomUUID(),
      image: payload.image,
      width: Number(payload.width) || 0,
      height: Number(payload.height) || 0,
      sentAt: Number(payload.sentAt) || Date.now(),
    });
  });

  // ---- Disconnect handling ------------------------------------------------
  socket.on('disconnect', () => {
    const desktopRoom = findRoomByDesktop(socket.id);
    if (desktopRoom) {
      io.to(desktopRoom.code).emit('room:closed');
      deleteRoom(desktopRoom.code);
    }
    for (const room of findRoomsByPhone(socket.id)) {
      room.phones.delete(socket.id);
      io.to(room.desktopId).emit('room:phone-disconnected', {
        phones: room.phones.size,
      });
    }
  });
});

setInterval(() => {
  sweepExpiredRooms((room) => io.to(room.code).emit('room:closed'));
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`PortalDrop server listening on :${PORT}`);
});

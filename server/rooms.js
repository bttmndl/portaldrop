// In-memory room store. Phase 1 keeps this simple — Redis comes later
// when we need multi-instance scaling.

const ROOM_TTL_MS = 30 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map();

function generateCode() {
  let code;
  do {
    code = Array.from(
      { length: 6 },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

export function createRoom(desktopSocketId) {
  const room = {
    code: generateCode(),
    desktopId: desktopSocketId,
    phones: new Set(),
    createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase()) || null;
}

export function deleteRoom(code) {
  rooms.delete(code);
}

export function findRoomByDesktop(socketId) {
  for (const room of rooms.values()) {
    if (room.desktopId === socketId) return room;
  }
  return null;
}

export function findRoomsByPhone(socketId) {
  const found = [];
  for (const room of rooms.values()) {
    if (room.phones.has(socketId)) found.push(room);
  }
  return found;
}

export function sweepExpiredRooms(onExpire) {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      onExpire?.(room);
      rooms.delete(room.code);
    }
  }
}

export function roomCount() {
  return rooms.size;
}

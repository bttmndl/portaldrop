import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { socket } from '../socket.js';
import Portal from '../components/Portal.jsx';
import StageObject from '../components/StageObject.jsx';

const PORTAL_SIZE = 340;

function landingSpot(width) {
  // Land objects in a comfortable band around the middle of the screen,
  // away from the extreme edges.
  const pad = 80;
  const x = pad + Math.random() * Math.max(1, window.innerWidth - width - pad * 2);
  const y = pad + Math.random() * Math.max(1, window.innerHeight - width - pad * 2);
  return { x, y };
}

export default function Desktop() {
  const [roomCode, setRoomCode] = useState(null);
  const [phones, setPhones] = useState(0);
  const [objects, setObjects] = useState([]);
  const [flare, setFlare] = useState(false);
  const flareTimer = useRef(null);

  useEffect(() => {
    socket.connect();

    const createRoom = () => {
      socket.emit('room:create', (res) => {
        if (res?.ok) setRoomCode(res.code);
      });
    };

    const onPhoneConnected = ({ phones }) => setPhones(phones);
    const onPhoneDisconnected = ({ phones }) => setPhones(phones);

    const onObjectIncoming = (payload) => {
      const width = Math.min(360, Math.max(220, window.innerWidth * 0.22));
      const spot = landingSpot(width);
      setObjects((prev) => [...prev, { ...payload, ...spot, width }]);
      setFlare(true);
      clearTimeout(flareTimer.current);
      flareTimer.current = setTimeout(() => setFlare(false), 900);
    };

    const onRoomClosed = () => {
      setPhones(0);
      createRoom();
    };

    socket.on('connect', createRoom);
    socket.on('room:phone-connected', onPhoneConnected);
    socket.on('room:phone-disconnected', onPhoneDisconnected);
    socket.on('object:incoming', onObjectIncoming);
    socket.on('room:closed', onRoomClosed);

    if (socket.connected) createRoom();

    return () => {
      socket.off('connect', createRoom);
      socket.off('room:phone-connected', onPhoneConnected);
      socket.off('room:phone-disconnected', onPhoneDisconnected);
      socket.off('object:incoming', onObjectIncoming);
      socket.off('room:closed', onRoomClosed);
      clearTimeout(flareTimer.current);
      socket.disconnect();
    };
  }, []);

  const moveObject = (id, pos) =>
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, ...pos } : o)));

  const deleteObject = (id) =>
    setObjects((prev) => prev.filter((o) => o.id !== id));

  const joinUrl = roomCode
    ? `${window.location.origin}/join/${roomCode}`
    : null;

  const paired = phones > 0;
  const portalCenter = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };

  return (
    <div className="desktop">
      <div className="desktop__brand">
        Portal<span>Drop</span>
      </div>

      <div className={`desktop__status glass${paired ? ' is-live' : ''}`}>
        <span className="dot" />
        {paired
          ? `${phones} phone${phones > 1 ? 's' : ''} connected`
          : 'Waiting for a phone'}
      </div>

      <div className="pairing">
        <Portal size={PORTAL_SIZE} flare={flare}>
          {!paired && joinUrl && (
            <div className="qr-shell">
              <QRCodeSVG value={joinUrl} size={168} level="M" />
            </div>
          )}
        </Portal>

        {!paired ? (
          <>
            <h1>Scan the code. Point at anything. Throw it through.</h1>
            <p>Open your phone camera and scan the QR code inside the portal.</p>
            {roomCode && <div className="room-code">{roomCode}</div>}
          </>
        ) : (
          <>
            <h1>Portal open</h1>
            <p>Capture an object on your phone and send it through.</p>
          </>
        )}
      </div>

      <div className="stage">
        {objects.map((object) => (
          <StageObject
            key={object.id}
            object={object}
            portalCenter={portalCenter}
            onMove={moveObject}
            onDelete={deleteObject}
          />
        ))}
      </div>

      {objects.length > 0 && (
        <div className="desktop__hint glass">
          Drag objects to move them · hover for delete
        </div>
      )}
    </div>
  );
}

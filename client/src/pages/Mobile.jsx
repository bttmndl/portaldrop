import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket.js';

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;

// Phases: joining -> ask-camera -> live -> confirm -> sending -> live
export default function Mobile() {
  const { code } = useParams();
  const [phase, setPhase] = useState('joining');
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureRef = useRef(null); // { image, width, height }
  const [still, setStill] = useState(null);

  // ---- join room ----------------------------------------------------------
  useEffect(() => {
    socket.connect();

    const join = () => {
      socket.emit('room:join', { code }, (res) => {
        if (res?.ok) {
          setPhase((p) => (p === 'joining' ? 'ask-camera' : p));
        } else {
          setError('This portal has closed or the code is wrong. Rescan the QR on your desktop.');
        }
      });
    };

    const onRoomClosed = () =>
      setError('The desktop closed the portal. Rescan the QR code to reconnect.');

    socket.on('connect', join);
    socket.on('room:closed', onRoomClosed);
    if (socket.connected) join();

    return () => {
      socket.off('connect', join);
      socket.off('room:closed', onRoomClosed);
      socket.disconnect();
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // ---- camera -------------------------------------------------------------
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setPhase('live');
    } catch {
      setError('Camera access is required. Allow camera permission and reload.');
    }
  }, []);

  // Attach the stream once the <video> for the live phase is mounted.
  useEffect(() => {
    if (phase === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [phase]);

  // ---- capture ------------------------------------------------------------
  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    const image = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    captureRef.current = { image, width: canvas.width, height: canvas.height };
    setStill(image);
    setPhase('confirm');
    if (navigator.vibrate) navigator.vibrate(20);
  };

  const retake = () => {
    setStill(null);
    setPhase('live');
  };

  // ---- send through the portal ---------------------------------------------
  const send = () => {
    setPhase('sending');
    if (navigator.vibrate) navigator.vibrate([15, 40, 60]);

    // Emit mid-animation so the desktop arrival overlaps the phone suck-in.
    setTimeout(() => {
      const c = captureRef.current;
      socket.emit('object:transfer', {
        code,
        image: c.image,
        width: c.width,
        height: c.height,
        sentAt: Date.now(),
      });
    }, 350);

    // Animation is 800ms — return to live camera after it finishes.
    setTimeout(() => {
      setStill(null);
      setPhase('live');
      setToast('Sent through the portal ✦');
      setTimeout(() => setToast(null), 2200);
    }, 900);
  };

  // ---- render ---------------------------------------------------------------
  if (error) {
    return (
      <div className="mobile">
        <div className="mobile__panel glass">
          <h1>Portal unavailable</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (phase === 'joining') {
    return (
      <div className="mobile">
        <div className="mobile__panel glass">
          <h1>Connecting…</h1>
          <p>Linking to portal {code}</p>
        </div>
      </div>
    );
  }

  if (phase === 'ask-camera') {
    return (
      <div className="mobile">
        <div className="mobile__panel glass">
          <h1>You're connected</h1>
          <p>
            PortalDrop needs your camera to capture objects. Nothing is stored —
            frames go straight to your own desktop.
          </p>
          <button className="btn-primary" onClick={startCamera}>
            Open camera
          </button>
        </div>
      </div>
    );
  }

  const confirming = phase === 'confirm';
  const sending = phase === 'sending';

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted autoPlay />

      {still && (
        <img
          className={`camera__still${sending ? ' is-sending' : ''}`}
          src={still}
          alt="Captured frame"
        />
      )}

      <div className={`camera__portal-glow${confirming || sending ? ' is-open' : ''}`} />

      <div className="camera__topbar">
        <div className="camera__room glass">{code}</div>
      </div>

      <div className="camera__controls">
        {phase === 'live' && (
          <button className="shutter" onClick={capture} aria-label="Capture" />
        )}
        {confirming && (
          <div className="confirm-actions">
            <button className="btn-ghost" onClick={retake}>
              Retake
            </button>
            <button className="btn-primary" onClick={send}>
              Send through portal
            </button>
          </div>
        )}
      </div>

      {toast && <div className="toast glass">{toast}</div>}
    </div>
  );
}

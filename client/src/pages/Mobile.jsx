import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket.js';
import { getSegmenter, segmentAt } from '../lib/segmenter.js';
import { useARSupport } from '../lib/arSession.js';
import ARViewer from '../components/ARViewer.jsx';

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
  const stillImgRef = useRef(null);
  const captureRef = useRef(null); // { image, width, height }
  const [still, setStill] = useState(null);

  // ---- click-to-pick the object out of the still ---------------------------
  const [aiState, setAiState] = useState('loading'); // loading | ready | error
  const [busyPoint, setBusyPoint] = useState(null);
  const [extracted, setExtracted] = useState(null); // { src, aspect }
  const [arOpen, setArOpen] = useState(false);
  const arSupported = useARSupport();

  // Warm the segmenter once the camera is live so it's ready by capture time.
  useEffect(() => {
    if (phase !== 'live') return;
    let alive = true;
    getSegmenter()
      .then(() => alive && setAiState('ready'))
      .catch(() => alive && setAiState('error'));
    return () => { alive = false; };
  }, [phase]);

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
    setExtracted(null);
    setPhase('live');
  };

  // Tap the still to lift the object out as a transparent cutout.
  // The still uses object-fit: cover, so the tap point has to be un-cropped
  // back into the source image's own coordinate space before segmenting.
  const pick = async (e) => {
    if (phase !== 'confirm' || busyPoint || aiState !== 'ready') return;
    const img = stillImgRef.current;
    const rect = img.getBoundingClientRect();
    const dispX = e.clientX - rect.left;
    const dispY = e.clientY - rect.top;

    const { naturalWidth: iw, naturalHeight: ih } = img;
    const coverScale = Math.max(rect.width / iw, rect.height / ih);
    const offsetX = (rect.width - iw * coverScale) / 2;
    const offsetY = (rect.height - ih * coverScale) / 2;
    const normX = (dispX - offsetX) / (iw * coverScale);
    const normY = (dispY - offsetY) / (ih * coverScale);
    if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return;

    setBusyPoint({ x: dispX, y: dispY });
    try {
      const result = await segmentAt(img, normX, normY);
      if (!result) {
        setToast('No clear object there — tap closer to its center.');
        setTimeout(() => setToast(null), 2200);
        return;
      }
      setExtracted({ src: result.cutout, aspect: result.bbox.w / result.bbox.h });
      if (navigator.vibrate) navigator.vibrate(15);
    } catch {
      setToast('Pick failed on this device.');
      setTimeout(() => setToast(null), 2200);
    } finally {
      setBusyPoint(null);
    }
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
        image: extracted ? extracted.src : c.image,
        width: c.width,
        height: c.height,
        sentAt: Date.now(),
      });
    }, 350);

    // Animation is 800ms — return to live camera after it finishes.
    setTimeout(() => {
      setStill(null);
      setExtracted(null);
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
          ref={stillImgRef}
          className={`camera__still${sending ? ' is-sending' : ''}${extracted ? ' is-picked' : ''}`}
          src={still}
          alt="Captured frame"
          onClick={pick}
        />
      )}

      {busyPoint && (
        <div className="extract-spinner" style={{ left: busyPoint.x, top: busyPoint.y }} />
      )}

      {extracted && !sending && (
        <div className="camera__pick">
          <div className="cutout__halo" />
          <img src={extracted.src} alt="Picked object" draggable={false} />
        </div>
      )}

      <div className={`camera__portal-glow${confirming || sending ? ' is-open' : ''}`} />

      <div className="camera__topbar">
        <div className="camera__room glass">{code}</div>
      </div>

      {confirming && !extracted && (
        <div className="camera__pick-hint glass">
          {aiState === 'ready' && 'Tap the object to lift it out'}
          {aiState === 'loading' && 'AI warming up…'}
          {aiState === 'error' && 'AI unavailable — you can still send the full photo'}
        </div>
      )}

      <div className="camera__controls">
        {phase === 'live' && (
          <button className="shutter" onClick={capture} aria-label="Capture" />
        )}
        {confirming && (
          <div className="confirm-actions">
            <button className="btn-ghost" onClick={retake}>
              Retake
            </button>
            {extracted && arSupported && (
              <button className="btn-ghost" onClick={() => setArOpen(true)}>
                View in AR
              </button>
            )}
            <button className="btn-primary" onClick={send}>
              {extracted ? 'Send object' : 'Send through portal'}
            </button>
          </div>
        )}
      </div>

      {toast && <div className="toast glass">{toast}</div>}

      {arOpen && extracted && (
        <ARViewer
          imageSrc={extracted.src}
          aspect={extracted.aspect}
          onClose={() => setArOpen(false)}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket.js';
import { getSegmenter, segmentAt } from '../lib/segmenter.js';
import ARHandViewer from '../components/ARHandViewer.jsx';

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;

// Phases: joining -> ask-camera -> live
// Within "live", grab tracks the hold-the-shutter gesture:
// idle -> extracting (segmenting the object under the crosshair while held)
//      -> held (object floats, ready to aim) -> throwing (sent on release)
// The shutter always throws through the portal to the desktop — unchanged.
// "View on my hand" is a completely separate control: a single tap on its
// own button, independent of the shutter/held/portal state machine. It
// never touches the socket or the desktop, it just opens AR right here.
export default function Mobile() {
  const { code } = useParams();
  const [phase, setPhase] = useState('joining');
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [aiState, setAiState] = useState('loading'); // loading | ready | error
  const [grab, setGrab] = useState('idle');
  const [heldCutout, setHeldCutout] = useState(null); // { src, aspect }
  const [handAR, setHandAR] = useState(null); // { src } while viewing on-hand AR
  const [handGrabbing, setHandGrabbing] = useState(false);
  const releasedRef = useRef(false); // shutter released while still extracting

  // Warm the segmenter once the camera is live so it's ready by grab time.
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
      // Re-calling this while already in the 'live' phase (e.g. resuming
      // after hand AR closes) won't retrigger the attach effect below —
      // React bails out on an identical setPhase('live') — so attach here too.
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
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

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const grabFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  // Segment whatever's under the crosshair right now. Shared by both the
  // shutter (-> portal) and the standalone hand button (-> local AR).
  const captureCutout = async () => {
    const canvas = grabFrame();
    if (!canvas) return null;
    if (aiState === 'ready') {
      try {
        const result = await segmentAt(canvas, 0.5, 0.5);
        return result
          ? { src: result.cutout, aspect: result.bbox.w / result.bbox.h }
          : { src: canvas.toDataURL('image/jpeg', JPEG_QUALITY), aspect: canvas.width / canvas.height };
      } catch {
        return { src: canvas.toDataURL('image/jpeg', JPEG_QUALITY), aspect: canvas.width / canvas.height };
      }
    }
    return { src: canvas.toDataURL('image/jpeg', JPEG_QUALITY), aspect: canvas.width / canvas.height };
  };

  // ---- hold the shutter to grab whatever's under the crosshair -------------
  const onHoldStart = async () => {
    if (phase !== 'live' || grab !== 'idle') return;
    releasedRef.current = false;
    setGrab('extracting');
    if (navigator.vibrate) navigator.vibrate(15);

    const cutout = await captureCutout();
    if (!cutout) { setGrab('idle'); return; }

    if (navigator.vibrate) navigator.vibrate(15);
    if (releasedRef.current) {
      throwObject(cutout); // they let go before we finished grabbing — send right away
    } else {
      setHeldCutout(cutout);
      setGrab('held');
    }
  };

  const onHoldEnd = () => {
    releasedRef.current = true;
    if (grab === 'held') throwObject(heldCutout);
    else if (grab === 'idle') releasedRef.current = false; // nothing was pending
  };

  // ---- release: throw the held object through the portal -------------------
  const throwObject = (cutout) => {
    if (!cutout) {
      setGrab('idle');
      return;
    }
    setHeldCutout(cutout);
    setGrab('throwing');
    if (navigator.vibrate) navigator.vibrate([15, 40, 60]);

    setTimeout(() => {
      socket.emit('object:transfer', {
        code,
        image: cutout.src,
        width: 0,
        height: 0,
        sentAt: Date.now(),
      });
    }, 250);

    setTimeout(() => {
      setGrab('idle');
      setHeldCutout(null);
      releasedRef.current = false;
      flash('Sent through the portal ✦');
    }, 650);
  };

  // ---- standalone: capture + view on your own hand, right here -------------
  // Entirely separate from the shutter/portal flow above — no socket emit,
  // no desktop involved at all.
  const grabForHand = async () => {
    if (phase !== 'live' || grab !== 'idle' || handGrabbing) return;
    setHandGrabbing(true);
    if (navigator.vibrate) navigator.vibrate(15);
    const cutout = await captureCutout();
    setHandGrabbing(false);
    if (!cutout) return;
    if (navigator.vibrate) navigator.vibrate(15);
    stopCamera(); // free the physical camera before ARHandViewer opens its own stream
    setHandAR(cutout);
  };

  const closeHandAR = () => {
    setHandAR(null);
    startCamera(); // resume the live preview
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

  const held = grab === 'held' || grab === 'throwing';

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted autoPlay />

      {(grab === 'idle' || grab === 'extracting') && (
        <div className={`camera__reticle${grab === 'extracting' ? ' is-busy' : ''}`} />
      )}

      {heldCutout && (
        <div className={`camera__pick${grab === 'throwing' ? ' is-thrown' : ''}`}>
          <div className="cutout__halo" />
          <img src={heldCutout.src} alt="Held object" draggable={false} />
        </div>
      )}

      <div className={`camera__portal-glow${held ? ' is-open' : ''}`} />

      <div className="camera__topbar">
        <div className="camera__room glass">{code}</div>
      </div>

      <div className="camera__pick-hint glass">
        {grab === 'idle' && !handGrabbing && aiState === 'ready' && 'Hold the shutter to throw through the portal, or tap 🖐️ to try it on your hand'}
        {grab === 'idle' && !handGrabbing && aiState === 'loading' && 'AI warming up… you can still grab'}
        {grab === 'idle' && !handGrabbing && aiState === 'error' && 'Hold the shutter to grab the whole frame'}
        {handGrabbing && 'Grabbing for your hand…'}
        {grab === 'extracting' && 'Grabbing…'}
        {grab === 'held' && 'Point your camera at the desktop, then let go'}
        {grab === 'throwing' && 'Throwing it through ✦'}
      </div>

      <div className="camera__controls">
        <button
          className={`camera__hand-btn${handGrabbing ? ' is-busy' : ''}`}
          onClick={grabForHand}
          disabled={grab !== 'idle' || handGrabbing}
          aria-label="Capture and view on your hand"
          title="View on your hand"
        >
          🖐️
        </button>
        <button
          className={`shutter${grab !== 'idle' ? ' is-holding' : ''}`}
          onPointerDown={onHoldStart}
          onPointerUp={onHoldEnd}
          onPointerCancel={onHoldEnd}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Hold to grab, release to throw"
        />
      </div>

      {toast && <div className="toast glass">{toast}</div>}
      {handAR && <ARHandViewer imageSrc={handAR.src} onClose={closeHandAR} />}
    </div>
  );
}

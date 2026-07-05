import { useEffect, useRef, useState } from 'react';
import { startARPlacement } from '../lib/arSession.js';

// Full-screen WebXR AR overlay: taps a real-world surface through the
// device camera and drops the transparent cutout there at true scale.
export default function ARViewer({ imageSrc, aspect, onClose }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const sessionRef = useRef(null);
  const [status, setStatus] = useState('starting'); // starting | placing | placed | error
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;

    startARPlacement({
      canvas: canvasRef.current,
      overlay: overlayRef.current,
      imageSrc,
      aspect,
      onPlaced: () => !cancelled && setStatus('placed'),
      onEnd: () => !cancelled && onClose(),
    })
      .then((session) => {
        if (cancelled) {
          session.end();
          return;
        }
        sessionRef.current = session;
        setStatus('placing');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(err.message || 'AR session failed to start.');
      });

    return () => {
      cancelled = true;
      sessionRef.current?.end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (sessionRef.current) sessionRef.current.end();
    else onClose();
  };

  return (
    <div className="ar-viewer">
      <canvas ref={canvasRef} className="ar-viewer__canvas" />
      {/* dom-overlay root — 2D UI composited on top of the passthrough camera;
          kept separate from the WebGL canvas that XR presents directly. */}
      <div className="ar-viewer__overlay" ref={overlayRef}>
        <div className="ar-viewer__topbar">
          <button className="ar-viewer__close" onClick={close} aria-label="Exit AR">
            × Exit AR
          </button>
        </div>
        {(status === 'placing' || status === 'placed') && (
          <div className="ar-viewer__hint glass">
            {status === 'placing'
              ? 'Move your phone to find a surface, then tap to place the object.'
              : 'Placed! Tap again to move it.'}
          </div>
        )}
        {status === 'error' && (
          <div className="ar-viewer__error glass">
            <p>{errorMsg}</p>
            <button className="btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import { useARSupport } from '../lib/arSession.js';
import ARViewer from './ARViewer.jsx';
import Reconstruct3D from './Reconstruct3D.jsx';
import ARHandViewer from './ARHandViewer.jsx';

const CLICK_MOVE_THRESHOLD = 5; // px — below this, a pointerdown+up counts as a click, not a drag
const handAvailable = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

// A captured object living on the desktop canvas.
// Arrives from the portal center, then becomes draggable via pointer events.
// Clicking it (without dragging) opens the ultra-realistic 3D reconstruction.
export default function StageObject({ object, portalCenter, onMove, onDelete }) {
  const [arriving, setArriving] = useState(true);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [arOpen, setArOpen] = useState(false);
  const [reconOpen, setReconOpen] = useState(false);
  const [handAROpen, setHandAROpen] = useState(false);
  const [aspect, setAspect] = useState(1);
  const dragRef = useRef(null);
  const arSupported = useARSupport();

  const startDrag = (e) => {
    if (arriving) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { x: object.x, y: object.y };
    let moved = false;

    const onPointerMove = (ev) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > CLICK_MOVE_THRESHOLD) moved = true;
      onMove(object.id, {
        x: origin.x + (ev.clientX - startX),
        y: origin.y + (ev.clientY - startY),
      });
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (!moved) setReconOpen(true);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onHoverMove = (e) => {
    if (arriving) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: -py * 18, ry: px * 18 });
  };

  return (
    <div
      ref={dragRef}
      className={`stage-object${arriving ? ' is-arriving' : ''}`}
      style={{
        width: object.width,
        transform: arriving ? undefined : `translate(${object.x}px, ${object.y}px)`,
        '--from-x': `${portalCenter.x - object.width / 2}px`,
        '--from-y': `${portalCenter.y - object.width / 2}px`,
        '--to-x': `${object.x}px`,
        '--to-y': `${object.y}px`,
        cursor: arriving ? 'default' : 'grab',
      }}
      onPointerDown={startDrag}
      onPointerMove={onHoverMove}
      onPointerLeave={() => setTilt({ rx: 0, ry: 0 })}
      onAnimationEnd={() => setArriving(false)}
    >
      <img
        src={object.image}
        alt="Captured object"
        draggable={false}
        onLoad={(e) => setAspect(e.target.naturalWidth / e.target.naturalHeight || 1)}
        style={{ transform: `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }}
      />
      <div className="stage-object__actions">
        {arSupported && (
          <button
            className="stage-object__btn"
            onClick={() => setArOpen(true)}
            aria-label="View in AR"
            title="View in AR"
          >
            📱
          </button>
        )}
        {handAvailable && (
          <button
            className="stage-object__btn"
            onClick={() => setHandAROpen(true)}
            aria-label="View on my hand"
            title="View on my hand"
          >
            🖐️
          </button>
        )}
        <button
          className="stage-object__btn is-danger"
          onClick={() => onDelete(object.id)}
          aria-label="Delete object"
          title="Delete"
        >
          ×
        </button>
      </div>

      {arOpen && (
        <ARViewer imageSrc={object.image} aspect={aspect} onClose={() => setArOpen(false)} />
      )}
      {reconOpen && (
        <Reconstruct3D
          imageSrc={object.image}
          onClose={() => setReconOpen(false)}
          onViewOnHand={handAvailable ? () => { setReconOpen(false); setHandAROpen(true); } : undefined}
        />
      )}
      {handAROpen && (
        <ARHandViewer imageSrc={object.image} onClose={() => setHandAROpen(false)} />
      )}
    </div>
  );
}

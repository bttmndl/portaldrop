import { useRef, useState } from 'react';
import { useARSupport } from '../lib/arSession.js';
import ARViewer from './ARViewer.jsx';

// A captured object living on the desktop canvas.
// Arrives from the portal center, then becomes draggable via pointer events.
export default function StageObject({ object, portalCenter, onMove, onDelete }) {
  const [arriving, setArriving] = useState(true);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [arOpen, setArOpen] = useState(false);
  const [aspect, setAspect] = useState(1);
  const dragRef = useRef(null);
  const arSupported = useARSupport();

  const startDrag = (e) => {
    if (arriving) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { x: object.x, y: object.y };

    const onPointerMove = (ev) => {
      onMove(object.id, {
        x: origin.x + (ev.clientX - startX),
        y: origin.y + (ev.clientY - startY),
      });
    };
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
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
    </div>
  );
}

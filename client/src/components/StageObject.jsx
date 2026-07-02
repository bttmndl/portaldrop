import { useRef, useState } from 'react';

// A captured object living on the desktop canvas.
// Arrives from the portal center, then becomes draggable via pointer events.
export default function StageObject({ object, portalCenter, onMove, onDelete }) {
  const [arriving, setArriving] = useState(true);
  const dragRef = useRef(null);

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
      onAnimationEnd={() => setArriving(false)}
    >
      <img src={object.image} alt="Captured object" draggable={false} />
      <button
        className="stage-object__delete"
        onClick={() => onDelete(object.id)}
        aria-label="Delete object"
      >
        ×
      </button>
    </div>
  );
}

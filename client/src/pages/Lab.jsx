import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSegmenter, segmentAt } from '../lib/segmenter.js';
import { DEMO_OBJECTS } from '../lib/demoObjects.js';

// Picture Lab — click any object in a picture and the AI lifts it out as a
// transparent cutout that levitates above the photo, leaving a hole behind.

let uid = 0;

export default function Lab() {
  const canvasRef = useRef(null);   // the photo (natural resolution)
  const stageRef = useRef(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [aiState, setAiState] = useState('loading'); // loading | ready | error
  const [busyPoint, setBusyPoint] = useState(null);  // display coords while segmenting
  const [cutouts, setCutouts] = useState([]);
  const [notice, setNotice] = useState(null);

  // Warm the model up front — first init downloads ~6 MB.
  useEffect(() => {
    let alive = true;
    getSegmenter()
      .then(() => alive && setAiState('ready'))
      .catch(() => alive && setAiState('error'));
    return () => { alive = false; };
  }, []);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2600);
  };

  // ---- loading a picture ----------------------------------------------------
  const drawToCanvas = (imgLike, w, h) => {
    const canvas = canvasRef.current;
    const cap = 2200;
    const scale = Math.min(1, cap / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(imgLike, 0, 0, canvas.width, canvas.height);
    setCutouts([]);
    setHasPhoto(true);
  };

  const openFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = () => drawToCanvas(img, img.naturalWidth, img.naturalHeight);
    img.src = URL.createObjectURL(file);
  };

  const loadSample = useCallback(async () => {
    const w = 1400, h = 900;
    const scene = document.createElement('canvas');
    scene.width = w;
    scene.height = h;
    const ctx = scene.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#141833');
    bg.addColorStop(1, '#1d2547');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let x = 0; x < w; x += 70) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 70) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    const imgs = await Promise.all(
      DEMO_OBJECTS.map(
        (d) =>
          new Promise((res) => {
            const im = new Image();
            im.onload = () => res(im);
            im.src = d.image;
          })
      )
    );
    const spots = [
      [180, 180, 260], [640, 140, 220], [1050, 200, 280],
      [280, 560, 240], [720, 520, 300], [1120, 580, 230],
    ];
    imgs.forEach((im, i) => {
      const [x, y, s] = spots[i];
      ctx.drawImage(im, x, y, s, s);
    });
    drawToCanvas(scene, w, h);
  }, []);

  // ---- click to extract -------------------------------------------------------
  const onCanvasClick = async (e) => {
    if (!hasPhoto || busyPoint || aiState !== 'ready') return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dispX = e.clientX - rect.left;
    const dispY = e.clientY - rect.top;
    const normX = dispX / rect.width;
    const normY = dispY / rect.height;

    setBusyPoint({ x: dispX, y: dispY });
    try {
      const result = await segmentAt(canvas, normX, normY);
      if (!result) {
        flash('No clear object there — try clicking closer to its center.');
        return;
      }
      punchHole(result);
      const displayScale = rect.width / canvas.width;
      const { bbox } = result;
      const cutW = bbox.w * displayScale;
      const cutH = bbox.h * displayScale;
      const cutX = Math.max(12, Math.min(rect.width - cutW - 12, dispX - cutW / 2));
      const cutY = Math.max(12, Math.min(rect.height - cutH - 12, dispY - cutH / 2));
      setCutouts((prev) => [
        ...prev,
        {
          id: `cut-${++uid}`,
          src: result.cutout,
          x: cutX,
          y: cutY,
          w: cutW,
          h: cutH,
          ar: true,
        },
      ]);
    } catch {
      flash('Extraction failed on this device — try reloading the page.');
    } finally {
      setBusyPoint(null);
    }
  };

  // Paint a dark "ripped out" void where the object used to be.
  const punchHole = ({ maskCanvas }) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const hole = document.createElement('canvas');
    hole.width = canvas.width;
    hole.height = canvas.height;
    const hctx = hole.getContext('2d');
    // maskCanvas is a scaled-down copy of the photo — stretch it back over
    // the full photo resolution.
    hctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
    hctx.globalCompositeOperation = 'source-in';
    hctx.fillStyle = '#07080f';
    hctx.fillRect(0, 0, hole.width, hole.height);
    ctx.globalAlpha = 0.96;
    ctx.drawImage(hole, 0, 0);
    ctx.globalAlpha = 1;
  };

  const removeCutout = (id) =>
    setCutouts((prev) => prev.filter((c) => c.id !== id));

  const download = (cut) => {
    const a = document.createElement('a');
    a.href = cut.src;
    a.download = `portaldrop-object-${cut.id}.png`;
    a.click();
  };

  // ---- drag + drop file -------------------------------------------------------
  const onDrop = (e) => {
    e.preventDefault();
    openFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="lab" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="lab__topbar">
        <Link className="lab__back" to="/">← PortalDrop</Link>
        <div className="lab__title">Picture Lab</div>
        <div className={`lab__ai glass ai-${aiState}`}>
          {aiState === 'loading' && 'Warming up AI…'}
          {aiState === 'ready' && 'AI ready — click any object'}
          {aiState === 'error' && 'AI failed to load'}
        </div>
      </div>

      {!hasPhoto ? (
        <div className="lab__empty">
          <div className="mobile__panel glass">
            <h1>Click an object. Watch it lift out.</h1>
            <p>
              Open any picture, then click an object in it — the AI extracts it
              as a transparent cutout and leaves a hole in the photo.
            </p>
            <label className="btn-primary lab__file">
              Open a picture
              <input
                type="file"
                accept="image/*"
                onChange={(e) => openFile(e.target.files?.[0])}
                hidden
              />
            </label>
            <button className="btn-ghost" onClick={loadSample}>
              Use a sample scene
            </button>
          </div>
        </div>
      ) : (
        <div className="lab__stage" ref={stageRef}>
          <canvas
            ref={canvasRef}
            className={`lab__photo${busyPoint ? ' is-busy' : ''}`}
            onClick={onCanvasClick}
          />
          {busyPoint && (
            <div
              className="extract-spinner"
              style={{ left: busyPoint.x, top: busyPoint.y }}
            />
          )}
          {cutouts.map((cut) => (
            <FloatingCutout
              key={cut.id}
              cut={cut}
              onDelete={() => removeCutout(cut.id)}
              onDownload={() => download(cut)}
            />
          ))}
        </div>
      )}

      {hasPhoto && (
        <div className="lab__toolbar">
          <label className="btn-ghost lab__file">
            Open another picture
            <input
              type="file"
              accept="image/*"
              onChange={(e) => openFile(e.target.files?.[0])}
              hidden
            />
          </label>
        </div>
      )}

      {notice && <div className="toast glass">{notice}</div>}
    </div>
  );
}

// A cutout hovering above the photo: levitates, tilts in 3D toward the
// cursor, draggable, with save/delete controls.
function FloatingCutout({ cut, onDelete, onDownload }) {
  const [pos, setPos] = useState({ x: cut.x, y: cut.y - 26 }); // lift on birth
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });

  const startDrag = (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const origin = { ...pos };
    const move = (ev) =>
      setPos({ x: origin.x + ev.clientX - sx, y: origin.y + ev.clientY - sy });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onHoverMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: -py * 22, ry: px * 22 });
  };

  return (
    <div
      className={`cutout${cut.ar ? ' cutout--ar' : ''}`}
      style={{ left: pos.x, top: pos.y, width: cut.w, height: cut.h }}
      onPointerDown={startDrag}
      onPointerMove={onHoverMove}
      onPointerLeave={() => setTilt({ rx: 0, ry: 0 })}
    >
      <div className="cutout__halo" />
      <img
        src={cut.src}
        alt="Extracted object"
        draggable={false}
        style={{
          transform: `perspective(700px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
        }}
      />
      {cut.ar && <div className="cutout__label">AR pick</div>}
      <div className="cutout__actions">
        <button className="cutout__btn" onClick={onDownload} title="Save PNG">⤓</button>
        <button className="cutout__btn is-danger" onClick={onDelete} title="Remove">×</button>
      </div>
    </div>
  );
}

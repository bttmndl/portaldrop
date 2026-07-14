import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildRelief, reliefMaterial } from '../lib/relief.js';
import { detectPalm } from '../lib/handTracking.js';

// Live "on your hand" AR: no WebXR needed (phone cameras don't expose real
// hand-tracking through the passthrough compositor anyway) — instead this
// runs the actual rear camera feed through MediaPipe Hand Landmarker,
// finds the palm every frame, and pins the reconstructed 3D relief object
// to it in screen space, scaled and rotated to match the hand.

const SMOOTH = 0.35; // higher = snappier, lower = smoother/laggier

function makeShadowSprite() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  return new THREE.Sprite(material);
}

// The video fills the stage via object-fit: cover, so it's cropped on one
// axis whenever the camera's aspect ratio doesn't match the screen's (the
// common case: landscape 16:9 camera in a portrait phone viewport). Map a
// normalized point in FULL video space into normalized STAGE space, same
// crop math the browser applies to the <video> itself, so the 3D object
// lines up with the hand under the visible (cropped) video pixels.
function videoPointToStage(xNorm, yNorm, videoW, videoH, stageW, stageH) {
  const scale = Math.max(stageW / videoW, stageH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const offX = (stageW - drawW) / 2;
  const offY = (stageH - drawH) / 2;
  return {
    x: (offX + xNorm * drawW) / stageW,
    y: (offY + yNorm * drawH) / stageH,
    scale, // px of stage per px of video — for converting size, not just position
  };
}

export default function ARHandViewer({ imageSrc, onClose }) {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const mountRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('starting'); // starting | searching | tracking | error
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let renderer, scene, camera, mesh, shadow, frameId;
    const smoothed = { x: 0.5, y: 0.5, scale: 0, rollDeg: 0, facing: 1 };
    let haveLock = false;

    const cleanupFns = [];

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        const { geometry, colorTexture } = await buildRelief(imageSrc, { maxDepth: 0.3 });
        if (cancelled) return;

        renderer = new THREE.WebGLRenderer({ canvas: mountRef.current, alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envRT = pmrem.fromScene(new RoomEnvironment(), 0.06);
        scene.environment = envRT.texture;
        pmrem.dispose();
        cleanupFns.push(() => envRT.dispose());

        const aspect = stageRef.current.clientWidth / stageRef.current.clientHeight;
        camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.01, 10);
        camera.position.set(0, 0, 2);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x30263f, 0.9));
        const key = new THREE.DirectionalLight(0xffffff, 2.0);
        key.position.set(0.6, 1.2, 1.5);
        scene.add(key);

        const material = reliefMaterial(colorTexture);
        mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        scene.add(mesh);

        shadow = makeShadowSprite();
        shadow.visible = false;
        scene.add(shadow);

        const resize = () => {
          if (!renderer || !stageRef.current) return;
          const w = stageRef.current.clientWidth;
          const h = stageRef.current.clientHeight;
          renderer.setSize(w, h, false);
          const a = w / h;
          camera.left = -a; camera.right = a; camera.top = 1; camera.bottom = -1;
          camera.updateProjectionMatrix();
        };
        resize();
        window.addEventListener('resize', resize);
        cleanupFns.push(() => window.removeEventListener('resize', resize));

        const detect = async () => {
          if (cancelled) return;
          try {
            const raw = await detectPalm(video, performance.now());
            const a = camera.right; // current half-width in world units
            const stageW = stageRef.current?.clientWidth || 1;
            const stageH = stageRef.current?.clientHeight || 1;

            // Re-express the raw (full-video-space) palm reading in stage
            // space, accounting for the object-fit: cover crop.
            const palm = raw && (() => {
              const mapped = videoPointToStage(raw.x, raw.y, video.videoWidth, video.videoHeight, stageW, stageH);
              return { ...raw, x: mapped.x, y: mapped.y, scale: raw.scale * mapped.scale * (video.videoWidth / stageW) };
            })();

            if (palm) {
              if (!haveLock) {
                // snap on first acquisition instead of easing in from center
                smoothed.x = palm.x; smoothed.y = palm.y; smoothed.scale = palm.scale;
                smoothed.rollDeg = palm.rollDeg; smoothed.facing = palm.facing;
                haveLock = true;
              } else {
                smoothed.x += (palm.x - smoothed.x) * SMOOTH;
                smoothed.y += (palm.y - smoothed.y) * SMOOTH;
                smoothed.scale += (palm.scale - smoothed.scale) * SMOOTH;
                smoothed.rollDeg += (palm.rollDeg - smoothed.rollDeg) * SMOOTH;
                smoothed.facing += (palm.facing - smoothed.facing) * SMOOTH;
              }

              const wx = (smoothed.x - 0.5) * 2 * a;
              const wy = (0.5 - smoothed.y) * 2 * 1;
              const worldSize = Math.max(0.05, smoothed.scale * 2 * a * 1.8);

              mesh.position.set(wx, wy, 0);
              mesh.scale.setScalar(worldSize);
              mesh.rotation.z = (-smoothed.rollDeg * Math.PI) / 180;
              mesh.rotation.x = (1 - smoothed.facing) * 0.9;
              mesh.visible = true;

              shadow.position.set(wx, wy - worldSize * 0.42, -0.01);
              shadow.scale.set(worldSize * 1.1, worldSize * 0.5, 1);
              shadow.visible = true;

              if (!cancelled) setStatus('tracking');
            } else {
              haveLock = false;
              mesh.visible = false;
              shadow.visible = false;
              if (!cancelled) setStatus('searching');
            }
          } catch {
            // transient detection hiccup — keep looping
          }
          renderer.render(scene, camera);
          frameId = requestAnimationFrame(detect);
        };
        detect();
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err.message || 'Camera or hand-tracking failed to start.');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
      cleanupFns.forEach((fn) => fn());
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.map?.dispose();
        mesh.material.dispose();
      }
      renderer?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc]);

  return (
    <div className="ar-hand">
      <div className="ar-hand__stage" ref={stageRef}>
        <video ref={videoRef} className="ar-hand__video" playsInline muted autoPlay />
        <canvas ref={mountRef} className="ar-hand__canvas" />
      </div>

      <div className="ar-viewer__topbar">
        <button className="ar-viewer__close" onClick={onClose} aria-label="Exit hand AR">
          × Exit AR
        </button>
      </div>

      {status === 'starting' && (
        <div className="ar-viewer__hint glass">Starting camera…</div>
      )}
      {status === 'searching' && (
        <div className="ar-viewer__hint glass">Show your open palm to the camera</div>
      )}
      {status === 'tracking' && (
        <div className="ar-viewer__hint glass">On your hand ✦</div>
      )}
      {status === 'error' && (
        <div className="ar-viewer__error glass">
          <p>{errorMsg}</p>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    </div>
  );
}

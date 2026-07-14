import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildRelief, reliefMaterial } from '../lib/relief.js';

// Full-screen "reconstruction" viewer: turns the flat cutout into an
// inflated 3D relief mesh and shows it on a studio pedestal under real
// PBR/environment lighting, orbit-able from any angle.
export default function Reconstruct3D({ imageSrc, onClose, onViewOnHand }) {
  const mountRef = useRef(null);
  const [status, setStatus] = useState('building'); // building | ready | error

  useEffect(() => {
    let cancelled = false;
    let renderer, scene, camera, controls, frameId, mesh, envRT;
    const mount = mountRef.current;

    const resize = () => {
      if (!renderer || !mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    (async () => {
      try {
        const { geometry, colorTexture, aspect } = await buildRelief(imageSrc, { maxDepth: 0.3 });
        if (cancelled) return;

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mount.appendChild(renderer.domElement);

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x05060e);

        // Procedural studio environment for realistic reflections/clearcoat —
        // no external HDRI download needed.
        const pmrem = new THREE.PMREMGenerator(renderer);
        envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
        scene.environment = envRT.texture;
        pmrem.dispose();

        camera = new THREE.PerspectiveCamera(38, 1, 0.01, 20);
        camera.position.set(0, 0.15, 1.35);

        const key = new THREE.DirectionalLight(0xffffff, 2.4);
        key.position.set(1.2, 1.6, 1.6);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.radius = 4;
        scene.add(key);
        scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x1a1230, 0.6));
        const rim = new THREE.PointLight(0x7c9cff, 1.4, 6);
        rim.position.set(-1.4, 0.6, -1.2);
        scene.add(rim);

        const material = reliefMaterial(colorTexture);
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.position.y = 0.02;
        scene.add(mesh);

        // Soft pedestal so the object reads as sitting in real space.
        const pedestal = new THREE.Mesh(
          new THREE.CircleGeometry(Math.max(0.9, aspect), 48).rotateX(-Math.PI / 2),
          new THREE.ShadowMaterial({ opacity: 0.38 })
        );
        pedestal.position.y = -0.001;
        pedestal.receiveShadow = true;
        scene.add(pedestal);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 0.5;
        controls.maxDistance = 3;
        controls.maxPolarAngle = Math.PI * 0.62;
        controls.target.set(0, 0.05, 0);
        controls.autoRotate = true;
        controls.autoRotateSpeed = 2.4;

        resize();
        window.addEventListener('resize', resize);

        const animate = () => {
          frameId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

        setStatus('ready');
      } catch (err) {
        if (!cancelled) setStatus('error');
        // eslint-disable-next-line no-console
        console.error('3D reconstruction failed', err);
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('resize', resize);
      if (frameId) cancelAnimationFrame(frameId);
      controls?.dispose();
      envRT?.dispose();
      if (mesh) {
        mesh.geometry.dispose();
        mesh.material.map?.dispose();
        mesh.material.dispose();
      }
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [imageSrc]);

  // Portaled straight to <body>: this is meant to cover the real viewport,
  // but the object cards it's opened from apply a CSS `transform` (drag
  // position, arrival/lift animations) which makes them a new containing
  // block for any `position: fixed` descendant — without the portal this
  // fullscreen overlay would get trapped inside that small card instead.
  return createPortal(
    <div className="reconstruct3d">
      <div ref={mountRef} className="reconstruct3d__canvas" />

      <div className="reconstruct3d__topbar">
        <button className="ar-viewer__close" onClick={onClose} aria-label="Close 3D view">
          × Close
        </button>
        {onViewOnHand && (
          <button className="btn-ghost reconstruct3d__hand-btn" onClick={onViewOnHand}>
            🖐️ View on my hand
          </button>
        )}
      </div>

      {status === 'building' && (
        <div className="reconstruct3d__hint glass">Reconstructing in 3D…</div>
      )}
      {status === 'ready' && (
        <div className="reconstruct3d__hint glass">Drag to rotate · scroll to zoom</div>
      )}
      {status === 'error' && (
        <div className="ar-viewer__error glass">
          <p>Couldn't reconstruct this object.</p>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    </div>,
    document.body
  );
}

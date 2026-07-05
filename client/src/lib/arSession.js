// Real WebXR AR placement: drops a transparent cutout as a plane anchored
// in the physical world (via the device camera + hit-testing), not just a
// CSS parallax trick. Falls back gracefully where WebXR isn't available.

import { useEffect, useState } from 'react';
import * as THREE from 'three';

// Feature-detect immersive-ar once and share the result across components.
export function useARSupport() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let alive = true;
    isARSupported().then((ok) => alive && setSupported(ok));
    return () => { alive = false; };
  }, []);
  return supported;
}

export async function isARSupported() {
  if (!navigator.xr?.isSessionSupported) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

/**
 * Launch an immersive-ar session that lets the user tap a surface to place
 * a transparent-cutout plane in real space, sized to its true aspect ratio.
 *
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   overlay: HTMLElement,       // dom-overlay root (close button etc.)
 *   imageSrc: string,           // transparent PNG data URL
 *   aspect: number,             // width / height of the cutout
 *   onEnd?: () => void,
 *   onPlaced?: () => void,
 * }} opts
 * @returns {Promise<{ end: () => void }>}
 */
export async function startARPlacement({ canvas, overlay, imageSrc, aspect, onEnd, onPlaced }) {
  if (!(await isARSupported())) {
    throw new Error('immersive-ar not supported on this device/browser');
  }

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));

  // Reticle — shows where the object will land before the user taps.
  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x2dd6ff })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  // The floating object itself, sized ~35cm on its longer side.
  const longSide = 0.35;
  const w = aspect >= 1 ? longSide : longSide * aspect;
  const h = aspect >= 1 ? longSide / aspect : longSide;
  const texture = new THREE.TextureLoader().load(imageSrc);
  texture.colorSpace = THREE.SRGBColorSpace;
  const objectMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide })
  );
  objectMesh.visible = false;
  scene.add(objectMesh);

  let hitTestSource = null;
  let hitTestSourceRequested = false;
  let placed = false;
  let ended = false;

  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: overlay ? { root: overlay } : undefined,
  });

  const onSelect = () => {
    if (!reticle.visible) return;
    objectMesh.position.setFromMatrixPosition(reticle.matrix);
    objectMesh.quaternion.setFromRotationMatrix(reticle.matrix);
    // Face the plane toward the camera's side rather than lying flat.
    objectMesh.rotateX(Math.PI / 2);
    objectMesh.visible = true;
    if (!placed) {
      placed = true;
      onPlaced?.();
    }
  };
  session.addEventListener('select', onSelect);

  const cleanup = () => {
    if (ended) return;
    ended = true;
    session.removeEventListener('select', onSelect);
    renderer.setAnimationLoop(null);
    hitTestSource?.cancel?.();
    hitTestSource = null;
    texture.dispose();
    objectMesh.geometry.dispose();
    objectMesh.material.dispose();
    reticle.geometry.dispose();
    reticle.material.dispose();
    renderer.dispose();
    onEnd?.();
  };
  session.addEventListener('end', cleanup);

  await renderer.xr.setSession(session);

  renderer.setAnimationLoop((_timestamp, frame) => {
    if (!frame) return;
    const refSpace = renderer.xr.getReferenceSpace();
    const xrSession = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      hitTestSourceRequested = true;
      xrSession.requestReferenceSpace('viewer').then((viewerSpace) => {
        xrSession.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
        });
      });
      xrSession.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
    }

    if (hitTestSource) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length > 0) {
        const pose = hits[0].getPose(refSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
    }

    renderer.render(scene, camera);
  });

  return { end: () => session.end().catch(cleanup) };
}

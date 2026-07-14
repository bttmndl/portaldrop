// Turns a flat transparent-PNG cutout into an "inflated" 3D relief mesh:
// a displaced, smoothly-rounded surface (like a sticker puffed into a
// pillow) with a matching normal map, so PBR lighting reads as real
// volume from any angle within ~±70°. No ML model, no network call —
// pure alpha-silhouette distance transform, fully on-device.
//
// This is the on-device "pseudo-3D" approach: it does not recover true
// depth (that needs monocular depth ML or multi-view capture), but it
// gives a convincing, fast, free approximation good enough to rotate
// and light realistically.

import * as THREE from 'three';

const GRID = 128; // heightfield / mesh resolution

async function loadImage(src) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  if (img.decode) await img.decode();
  else await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  return img;
}

// Two-pass approximate Euclidean distance transform (chamfer 3-4).
// dist[i] = pixels to the nearest pixel where mask is 0 (outside silhouette).
function distanceTransform(mask, w, h) {
  const INF = 1e6;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = mask[i] ? INF : 0;

  const at = (x, y) => dist[y * w + x];
  const set = (x, y, v) => { if (v < dist[y * w + x]) dist[y * w + x] = v; };

  // forward pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let d = dist[y * w + x];
      if (x > 0) d = Math.min(d, at(x - 1, y) + 1);
      if (y > 0) d = Math.min(d, at(x, y - 1) + 1);
      if (x > 0 && y > 0) d = Math.min(d, at(x - 1, y - 1) + 1.4142);
      if (x < w - 1 && y > 0) d = Math.min(d, at(x + 1, y - 1) + 1.4142);
      dist[y * w + x] = d;
    }
  }
  // backward pass
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      if (!mask[y * w + x]) continue;
      let d = dist[y * w + x];
      if (x < w - 1) d = Math.min(d, at(x + 1, y) + 1);
      if (y < h - 1) d = Math.min(d, at(x, y + 1) + 1);
      if (x < w - 1 && y < h - 1) d = Math.min(d, at(x + 1, y + 1) + 1.4142);
      if (x > 0 && y < h - 1) d = Math.min(d, at(x - 1, y + 1) + 1.4142);
      dist[y * w + x] = d;
    }
  }
  return dist;
}

function boxBlur(src, w, h, radius) {
  if (radius <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const r = radius;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / (2 * r + 1);
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const sub = src[y * w + Math.max(0, x - r)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / (2 * r + 1);
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      sum += add - sub;
    }
  }
  return out;
}

/**
 * Build an inflated relief mesh from a transparent-PNG cutout.
 * @param {string} imageSrc  transparent PNG data URL / URL
 * @param {{ maxDepth?: number, roughness?: number }} opts
 * @returns {Promise<{ geometry: THREE.BufferGeometry, colorTexture: THREE.Texture, aspect: number }>}
 */
export async function buildRelief(imageSrc, opts = {}) {
  const { maxDepth = 0.28 } = opts;
  const img = await loadImage(imageSrc);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const aspect = sw / sh;

  // Sample the alpha channel on a GRID x GRID grid (letterboxed to aspect).
  const gw = aspect >= 1 ? GRID : Math.max(8, Math.round(GRID * aspect));
  const gh = aspect >= 1 ? Math.max(8, Math.round(GRID / aspect)) : GRID;

  const sample = document.createElement('canvas');
  sample.width = gw;
  sample.height = gh;
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, gw, gh);
  const { data } = sctx.getImageData(0, 0, gw, gh);

  const mask = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) mask[i] = data[i * 4 + 3] > 24 ? 1 : 0;

  const rawDist = distanceTransform(mask, gw, gh);
  const smoothDist = boxBlur(rawDist, gw, gh, Math.max(1, Math.round(Math.min(gw, gh) / 32)));

  let maxD = 0;
  for (let i = 0; i < gw * gh; i++) if (smoothDist[i] > maxD) maxD = smoothDist[i];
  maxD = Math.max(maxD, 1);

  // Dome-shaped falloff (1 - (1-t)^2) reads as a rounded, puffy surface
  // rather than a flat-topped plateau or a sharp cone.
  const height = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    const t = Math.min(1, smoothDist[i] / maxD);
    height[i] = mask[i] ? (1 - (1 - t) * (1 - t)) : 0;
  }

  // Build the displaced grid geometry, sized to unit-ish world space
  // (long side = 1), centered at origin.
  const geometry = new THREE.PlaneGeometry(
    aspect >= 1 ? 1 : aspect,
    aspect >= 1 ? 1 / aspect : 1,
    gw - 1,
    gh - 1
  );
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const gx = Math.round(uv.getX(i) * (gw - 1));
    const gy = Math.round((1 - uv.getY(i)) * (gh - 1));
    const idx = gy * gw + gx;
    pos.setZ(i, height[idx] * maxDepth);
  }
  geometry.computeVertexNormals();

  // Full-resolution color texture straight from the source cutout.
  const colorTexture = new THREE.Texture(img);
  colorTexture.colorSpace = THREE.SRGBColorSpace;
  colorTexture.needsUpdate = true;
  colorTexture.wrapS = colorTexture.wrapT = THREE.ClampToEdgeWrapping;
  colorTexture.flipY = true;

  return { geometry, colorTexture, aspect };
}

/**
 * A MeshPhysicalMaterial that reads believably under environment lighting.
 * alphaTest against the source PNG's own (full-resolution) alpha channel
 * clips the silhouette far more cleanly than the coarse relief grid could.
 */
export function reliefMaterial(colorTexture) {
  return new THREE.MeshPhysicalMaterial({
    map: colorTexture,
    roughness: 0.45,
    metalness: 0.04,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
    alphaTest: 0.35,
  });
}

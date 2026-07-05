// Click-to-extract powered by MediaPipe Interactive Segmenter.
// Give it an image and a click point; get back a transparent-PNG cutout,
// its bounding box, and a mask for punching a hole in the source photo.

import { FilesetResolver, InteractiveSegmenter } from '@mediapipe/tasks-vision';

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';

const MAX_SOURCE = 1600; // cap processing size; keeps segmentation <1s

let segmenterPromise = null;

async function buildSegmenter(delegate) {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return InteractiveSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });
}

export function getSegmenter() {
  if (!segmenterPromise) {
    // Try GPU first; some machines/browsers only support CPU.
    segmenterPromise = buildSegmenter('GPU').catch(() => buildSegmenter('CPU'));
    segmenterPromise.catch(() => { segmenterPromise = null; });
  }
  return segmenterPromise;
}

/**
 * Segment the object at a click point.
 * @param {HTMLCanvasElement|HTMLImageElement} source
 * @param {number} normX 0..1 click position in source
 * @param {number} normY 0..1
 * @returns {Promise<null | {
 *   cutout: string,        // transparent PNG data URL, cropped to the object
 *   bbox: {x,y,w,h},       // object bounds in SOURCE pixel coords
 *   maskCanvas: HTMLCanvasElement, // full-size alpha mask (white = object)
 * }>}
 */
export async function segmentAt(source, normX, normY) {
  const segmenter = await getSegmenter();

  // Work on a capped-size copy for speed.
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const scale = Math.min(1, MAX_SOURCE / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);

  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(source, 0, 0, w, h);

  const maskData = await new Promise((resolve, reject) => {
    try {
      segmenter.segment(work, { keypoint: { x: normX, y: normY } }, (result) => {
        const mask = result.categoryMask;
        const arr = mask ? Uint8Array.from(mask.getAsUint8Array()) : null;
        result.close?.();
        resolve(arr);
      });
    } catch (err) {
      reject(err);
    }
  });
  if (!maskData || maskData.length < w * h) return null;

  // The mask's polarity can vary; whatever value sits under the click IS
  // the object class. Everything matching that value belongs to the object.
  const clickIdx = Math.min(h - 1, Math.round(normY * h)) * w +
                   Math.min(w - 1, Math.round(normX * w));
  const objectValue = maskData[clickIdx];

  // Bounding box + object pixel count.
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (maskData[y * w + x] === objectValue) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // Reject degenerate results: nothing found, or "object" is the whole frame
  // (usually means the model latched onto the background).
  if (maxX < 0 || count > 0.9 * w * h) return null;

  // Build a soft-edged alpha mask canvas (white where object).
  const hardMask = document.createElement('canvas');
  hardMask.width = w;
  hardMask.height = h;
  const hctx = hardMask.getContext('2d');
  const maskImg = hctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const on = maskData[i] === objectValue ? 255 : 0;
    maskImg.data[i * 4] = 255;
    maskImg.data[i * 4 + 1] = 255;
    maskImg.data[i * 4 + 2] = 255;
    maskImg.data[i * 4 + 3] = on;
  }
  hctx.putImageData(maskImg, 0, 0);

  const softMask = document.createElement('canvas');
  softMask.width = w;
  softMask.height = h;
  const sctx = softMask.getContext('2d');
  sctx.filter = 'blur(1.2px)'; // feather the edges slightly
  sctx.drawImage(hardMask, 0, 0);

  // Cutout: photo pixels ∩ soft mask, cropped to bbox (+ small padding).
  const pad = 6;
  const bx = Math.max(0, minX - pad);
  const by = Math.max(0, minY - pad);
  const bw = Math.min(w - bx, maxX - minX + 1 + pad * 2);
  const bh = Math.min(h - by, maxY - minY + 1 + pad * 2);

  const cut = document.createElement('canvas');
  cut.width = bw;
  cut.height = bh;
  const cctx = cut.getContext('2d');
  cctx.drawImage(work, bx, by, bw, bh, 0, 0, bw, bh);
  cctx.globalCompositeOperation = 'destination-in';
  cctx.drawImage(softMask, bx, by, bw, bh, 0, 0, bw, bh);

  // Map bbox back to ORIGINAL source pixel coords.
  const inv = 1 / scale;
  return {
    cutout: cut.toDataURL('image/png'),
    bbox: {
      x: Math.round(bx * inv),
      y: Math.round(by * inv),
      w: Math.round(bw * inv),
      h: Math.round(bh * inv),
    },
    maskCanvas: softMask, // at work-canvas scale (w × h)
    maskScale: scale,
  };
}

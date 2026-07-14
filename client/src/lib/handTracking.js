// Live palm tracking powered by MediaPipe Hand Landmarker — the same
// @mediapipe/tasks-vision stack already used for click-to-segment, just a
// different task. Feeds video frames in, gets back a palm anchor (position,
// scale, rotation) usable to pin a 3D object onto a real hand in a plain
// camera feed, no WebXR/headset hand-tracking hardware required.

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let landmarkerPromise = null;

async function buildLandmarker(delegate) {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
  });
}

export function getHandLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = buildLandmarker('GPU').catch(() => buildLandmarker('CPU'));
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
}

// Landmark indices (MediaPipe Hands topology).
const WRIST = 0;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;

/**
 * Detect a palm anchor in a video frame.
 * @param {HTMLVideoElement} video
 * @param {number} timestampMs monotonically increasing timestamp (performance.now())
 * @returns {Promise<null | {
 *   x: number, y: number,        // palm center, normalized 0..1 (video space)
 *   scale: number,               // palm width, normalized 0..1 — proxy for hand size/distance
 *   rollDeg: number,             // in-plane rotation, wrist -> middle-knuckle direction
 *   facing: number,              // 0 (edge-on) .. 1 (palm flat toward camera), from landmark z spread
 *   handedness: 'Left' | 'Right',
 * }>}
 */
export async function detectPalm(video, timestampMs) {
  const landmarker = await getHandLandmarker();
  if (!video.videoWidth) return null;

  const result = landmarker.detectForVideo(video, timestampMs);
  const hand = result?.landmarks?.[0];
  if (!hand) return null;

  const wrist = hand[WRIST];
  const indexMcp = hand[INDEX_MCP];
  const middleMcp = hand[MIDDLE_MCP];
  const ringMcp = hand[RING_MCP];
  const pinkyMcp = hand[PINKY_MCP];

  const cx = (wrist.x + indexMcp.x + middleMcp.x + ringMcp.x + pinkyMcp.x) / 5;
  const cy = (wrist.y + indexMcp.y + middleMcp.y + ringMcp.y + pinkyMcp.y) / 5;

  const dx = middleMcp.x - wrist.x;
  const dy = middleMcp.y - wrist.y;
  const scale = Math.hypot(indexMcp.x - pinkyMcp.x, indexMcp.y - pinkyMcp.y);
  const rollDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;

  // z is depth relative to the wrist (MediaPipe convention: smaller/negative
  // is closer to camera). A flat palm keeps all knuckles near the same z;
  // an edge-on hand spreads them out. Use that spread as a facing proxy.
  const zSpread = Math.max(
    Math.abs(indexMcp.z - pinkyMcp.z),
    Math.abs(indexMcp.z - wrist.z)
  );
  const facing = Math.max(0, Math.min(1, 1 - zSpread * 6));

  return {
    x: cx,
    y: cy,
    scale,
    rollDeg,
    facing,
    handedness: result.handedness?.[0]?.[0]?.categoryName || 'Right',
  };
}

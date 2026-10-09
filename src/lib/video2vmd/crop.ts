// Crop pass: tracked square windows around the head and both wrists, located from the body pose. Face and
// hand estimators run on these windows, cut from the full-resolution frame and upscaled; their landmarks
// are mapped back to normalised analysed-area coordinates.
import { OneEuroFilter } from '@/engine/video2vmd/oneEuro';
import { LM } from '@/engine/video2vmd/landmarks';
import type { CropBox } from '@/engine/video2vmd/types';
import type { CropWindow } from './types';

/** Window in pixels of the analysed area: centre + side length. */
export interface PixelWindow {
  cx: number;
  cy: number;
  size: number;
}

export const FACE_INPUT = 256;
export const HAND_INPUT = 224;
/** Below these source-pixel sizes the estimators struggle (warned in the report). */
export const MIN_FACE_PX = 96;
export const MIN_HAND_PX = 64;

type Landmarks = ArrayLike<number>;
const VIS = 0.3;

function pt(lm: Landmarks, i: number, size: [number, number]): [number, number, number] {
  return [lm[i * 4] * size[0], lm[i * 4 + 1] * size[1], lm[i * 4 + 3] ?? 1];
}

const dist2 = (a: [number, number, number], b: [number, number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Head window from the body pose (nose, eyes, ears), or null when the head isn't visible. */
export function headWindow(lm: Landmarks, size: [number, number]): PixelWindow | null {
  const idx = [LM.nose, LM.leftEye, LM.rightEye, LM.leftEar, LM.rightEar];
  const pts = idx.map((i) => pt(lm, i, size)).filter((p) => p[2] >= VIS);
  if (pts.length < 2) return null;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const ears = dist2(pt(lm, LM.leftEar, size), pt(lm, LM.rightEar, size));
  const shoulders = dist2(pt(lm, LM.leftShoulder, size), pt(lm, LM.rightShoulder, size));
  const s = Math.max(2.2 * ears, 0.8 * shoulders, 24);
  // The face sits a little below the eye / ear line.
  return { cx, cy: cy + s * 0.06, size: s };
}

/**
 * Wrist window: around the hand landmarks (wrist, index, pinky, thumb), pushed a little past the wrist
 * along the forearm, sized from the forearm (and the torso when the forearm points at the camera).
 * `side` 0 = pose landmark 15 (MediaPipe "left wrist"), 1 = landmark 16.
 */
export function wristWindow(lm: Landmarks, side: 0 | 1, size: [number, number]): PixelWindow | null {
  const L =
    side === 0
      ? {
          w: LM.leftWrist,
          e: LM.leftElbow,
          i: LM.leftIndex,
          p: LM.leftPinky,
          t: LM.leftThumb,
          s: LM.leftShoulder,
        }
      : {
          w: LM.rightWrist,
          e: LM.rightElbow,
          i: LM.rightIndex,
          p: LM.rightPinky,
          t: LM.rightThumb,
          s: LM.rightShoulder,
        };
  const w = pt(lm, L.w, size);
  if (w[2] < VIS) return null;
  const e = pt(lm, L.e, size);
  const hand = [w, pt(lm, L.i, size), pt(lm, L.p, size), pt(lm, L.t, size)].filter((p) => p[2] >= VIS);
  const hx = hand.reduce((s, p) => s + p[0], 0) / hand.length;
  const hy = hand.reduce((s, p) => s + p[1], 0) / hand.length;
  const forearm = dist2(w, e);
  const upper = dist2(e, pt(lm, L.s, size));
  const torso = dist2(pt(lm, LM.leftShoulder, size), pt(lm, LM.leftHip, size));
  const s = Math.max(1.3 * forearm, 0.7 * upper, 0.4 * torso, 24);
  const k = forearm > 1 ? 0.12 : 0;
  return { cx: hx + (w[0] - e[0]) * k, cy: hy + (w[1] - e[1]) * k, size: s };
}

/**
 * Smooths a window over time (One Euro on centre and size; size changes rate-limited) and holds it for a
 * short while when the anchor disappears.
 */
export class CropTracker {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  private fs: OneEuroFilter;
  private last: PixelWindow | null = null;
  private missing = 0;

  constructor(
    private readonly holdFrames = 10,
    private readonly maxGrowth = 0.15,
    minCutoff = 1.5,
    beta = 0.05,
  ) {
    this.fx = new OneEuroFilter(minCutoff, beta);
    this.fy = new OneEuroFilter(minCutoff, beta);
    this.fs = new OneEuroFilter(minCutoff * 0.5, 0);
  }

  update(target: PixelWindow | null, dt: number): PixelWindow | null {
    if (!target) {
      this.missing++;
      if (this.missing > this.holdFrames) {
        this.reset();
        return null;
      }
      return this.last;
    }
    this.missing = 0;
    let size = target.size;
    if (this.last) {
      const lo = this.last.size * (1 - this.maxGrowth);
      const hi = this.last.size * (1 + this.maxGrowth);
      size = Math.min(hi, Math.max(lo, size));
    }
    const w: PixelWindow = {
      cx: this.fx.filter(target.cx, dt),
      cy: this.fy.filter(target.cy, dt),
      size: this.fs.filter(size, dt),
    };
    this.last = w;
    return w;
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fs.reset();
    this.last = null;
    this.missing = 0;
  }
}

/** Pixel window → normalised analysed-area window. */
export const toNormalized = (w: PixelWindow, size: [number, number]): CropWindow => ({
  x: (w.cx - w.size / 2) / size[0],
  y: (w.cy - w.size / 2) / size[1],
  w: w.size / size[0],
  h: w.size / size[1],
});

/** Crop-local normalised point → analysed-area normalised point. */
export const cropToArea = (c: CropWindow, x: number, y: number): [number, number] => [
  c.x + x * c.w,
  c.y + y * c.h,
];

/** Analysed-area normalised point → crop-local normalised point. */
export const areaToCrop = (c: CropWindow, x: number, y: number): [number, number] => [
  (x - c.x) / c.w,
  (y - c.y) / c.h,
];

/**
 * Source-pixel rectangle of a window, for drawing from the full-resolution frame. `areaCrop` is the
 * user's crop of the video (analysed area within the source), `source` the source pixel size.
 */
export function sourceRect(
  c: CropWindow,
  areaCrop: CropBox | null,
  source: [number, number],
): { sx: number; sy: number; sw: number; sh: number } {
  const a = areaCrop ?? { x: 0, y: 0, w: 1, h: 1 };
  return {
    sx: (a.x + c.x * a.w) * source[0],
    sy: (a.y + c.y * a.h) * source[1],
    sw: c.w * a.w * source[0],
    sh: c.h * a.h * source[1],
  };
}

/** Map estimator landmarks (crop-local normalised x, y, then any extra components) back to the area. */
export function mapPointsToArea(c: CropWindow, pts: ArrayLike<number>, stride: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += stride) {
    const [x, y] = cropToArea(c, pts[i], pts[i + 1]);
    out.push(x, y);
    for (let k = 2; k < stride; k++) out.push(pts[i + k]);
  }
  return out;
}

/** Side length of a window in source pixels (for the "too small" warnings). */
export const sourcePixels = (c: CropWindow, areaCrop: CropBox | null, source: [number, number]): number =>
  sourceRect(c, areaCrop, source).sw;

import { mirrorIndex, mpImageToNormalized, mpWorldToMmd } from './coords';
import { LANDMARK_COUNT, LIMBS, LM, OUTLIER_LIMBS } from './landmarks';
import { add, dist, lerp3, mid, normalize, scale, sub, type Vec3 } from './math';
import { oneEuroSeries } from './oneEuro';
import type { ConversionSettings, PoseSequence } from './types';

export const MMD_FPS = 30;

/** Pose data resampled to 30 fps, in MMD axes (metres) — the input to retargeting. */
export interface CleanTrack {
  fps: number;
  frameCount: number;
  /** Source time of each output frame (seconds). */
  times: number[];
  /** world[frame][landmark] in MMD axes, metres, hip-centred. */
  world: Vec3[][];
  /** image[frame][landmark] in pixels of the analysed area (x right, y down). */
  image: [number, number][][];
  visibility: number[][];
  /** Frame had an actual detection (not interpolated). */
  detected: boolean[];
  /** Per-frame flag: frame was repaired as a limb-length outlier. */
  outlier: boolean[];
  /** Landmarks never seen anywhere in the clip. */
  missingLandmarks: number[];
  /** Median limb lengths (metres) keyed "parent-child". */
  limbLengths: Record<string, number>;
  imageSize: [number, number];
  /** Jitter (mean |second difference| of key joints, mm/frame²) before and after cleaning. */
  jitterRaw: number;
  jitterClean: number;
}

interface Raw {
  times: number[];
  world: Vec3[][];
  image: [number, number][][];
  vis: number[][];
  valid: boolean[][];
  detected: boolean[];
}

function toRaw(seq: PoseSequence, settings: ConversionSettings): Raw {
  const [w, h] = seq.analysedSize;
  const raw: Raw = { times: [], world: [], image: [], vis: [], valid: [], detected: [] };
  for (const f of seq.frames) {
    const world: Vec3[] = [];
    const image: [number, number][] = [];
    const vis: number[] = [];
    const valid: boolean[] = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const s = mirrorIndex(i, settings.mirror) * 4;
      const v = f.detected ? Math.min(f.world[s + 3] ?? 0, f.image[s + 3] ?? 1) : 0;
      world.push(
        f.detected ? mpWorldToMmd(f.world[s], f.world[s + 1], f.world[s + 2], settings.mirror) : [0, 0, 0],
      );
      const [nx, ny] = f.detected ? mpImageToNormalized(f.image[s], f.image[s + 1], settings.mirror) : [0, 0];
      image.push([nx * w, ny * h]);
      vis.push(v);
      valid.push(f.detected && v >= settings.visibilityThreshold);
    }
    raw.times.push(f.time);
    raw.world.push(world);
    raw.image.push(image);
    raw.vis.push(vis);
    raw.valid.push(valid);
    raw.detected.push(f.detected);
  }
  return raw;
}

/**
 * Fill invalid samples of each landmark by linear interpolation between valid neighbours (holding at the
 * ends). Returns the landmarks that had no valid sample at all.
 */
export function fillGaps(
  times: number[],
  valid: boolean[][],
  world: Vec3[][],
  image: [number, number][][],
): number[] {
  const n = times.length;
  const missing: number[] = [];
  const copy = (j: number, a: number, b: number, l: number): void => {
    const t = a === b ? 0 : (times[j] - times[a]) / (times[b] - times[a]);
    world[j][l] = lerp3(world[a][l], world[b][l], t);
    image[j][l] = [
      image[a][l][0] + (image[b][l][0] - image[a][l][0]) * t,
      image[a][l][1] + (image[b][l][1] - image[a][l][1]) * t,
    ];
  };
  for (let l = 0; l < LANDMARK_COUNT; l++) {
    const ok: number[] = [];
    for (let i = 0; i < n; i++) if (valid[i][l]) ok.push(i);
    if (!ok.length) {
      missing.push(l);
      continue;
    }
    for (let j = 0; j < ok[0]; j++) copy(j, ok[0], ok[0], l);
    for (let j = ok[ok.length - 1] + 1; j < n; j++) copy(j, ok[ok.length - 1], ok[ok.length - 1], l);
    for (let k = 0; k + 1 < ok.length; k++) {
      for (let j = ok[k] + 1; j < ok[k + 1]; j++) copy(j, ok[k], ok[k + 1], l);
    }
  }
  return missing;
}

/** Linear resampling of a time series to `fps` over [start, end]. */
export function resampleTimes(start: number, end: number, fps: number): number[] {
  const count = Math.max(1, Math.floor((end - start) * fps + 1e-6) + 1);
  return Array.from({ length: count }, (_, k) => start + k / fps);
}

/** Index i such that times[i] <= t < times[i+1] (clamped), via binary search. */
function bracket(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (times[m] <= t) lo = m;
    else hi = m;
  }
  return lo;
}

export function resample<T>(
  times: number[],
  values: T[],
  at: number[],
  lerp: (a: T, b: T, t: number) => T,
): T[] {
  if (times.length === 1) return at.map(() => values[0]);
  return at.map((t) => {
    const i = bracket(times, t);
    const span = times[i + 1] - times[i];
    const u = span > 0 ? Math.min(1, Math.max(0, (t - times[i]) / span)) : 0;
    return lerp(values[i], values[i + 1], u);
  });
}

const limbKey = (a: number, b: number): string => `${a}-${b}`;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const JITTER_JOINTS = [LM.leftWrist, LM.rightWrist, LM.leftAnkle, LM.rightAnkle, LM.leftElbow, LM.rightElbow];

/** Mean |second difference| of key joints in millimetres per frame². */
export function jitterScore(world: Vec3[][]): number {
  let sum = 0;
  let count = 0;
  for (let i = 1; i < world.length - 1; i++) {
    for (const j of JITTER_JOINTS) {
      const acc = add(sub(world[i + 1][j], scale(world[i][j], 2)), world[i - 1][j]);
      sum += Math.hypot(acc[0], acc[1], acc[2]);
      count++;
    }
  }
  return count ? (sum / count) * 1000 : 0;
}

/**
 * Detection output → clean 30 fps track:
 * 1. gaps & low-visibility samples interpolated, 2. resampled to 30 fps, 3. limb-length outliers
 * rejected and re-interpolated, 4. zero-lag One Euro smoothing, 5. bone lengths normalised.
 */
export function cleanSequence(seq: PoseSequence, settings: ConversionSettings): CleanTrack {
  const raw = toRaw(seq, settings);
  const missingLandmarks = fillGaps(raw.times, raw.valid, raw.world, raw.image);

  // 30 fps resampling over the analysed range.
  const start = raw.times[0] ?? 0;
  const end = raw.times[raw.times.length - 1] ?? 0;
  const times = resampleTimes(start, end, MMD_FPS);
  const lerpFrame = (a: Vec3[], b: Vec3[], t: number): Vec3[] => a.map((p, i) => lerp3(p, b[i], t));
  const lerp2 = (a: [number, number][], b: [number, number][], t: number): [number, number][] =>
    a.map((p, i) => [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t]);
  const world = resample(raw.times, raw.world, times, lerpFrame);
  const image = resample(raw.times, raw.image, times, lerp2);
  const visibility = resample(raw.times, raw.vis, times, (a, b, t) => a.map((v, i) => v + (b[i] - v) * t));
  const nearest = (t: number): number => {
    const i = bracket(raw.times, t);
    return i + 1 < raw.times.length && Math.abs(raw.times[i + 1] - t) < Math.abs(raw.times[i] - t)
      ? i + 1
      : i;
  };
  const detected = times.map((t) => raw.detected[nearest(t)] ?? false);
  const jitterRaw = jitterScore(world);

  // Outlier rejection: limb lengths far from the clip median → distal landmark invalid → re-interpolate.
  const lengths: Record<string, number> = {};
  for (const [a, b] of OUTLIER_LIMBS) lengths[limbKey(a, b)] = median(world.map((f) => dist(f[a], f[b])));
  const valid = times.map(() => new Array<boolean>(LANDMARK_COUNT).fill(true));
  const outlier = times.map(() => false);
  world.forEach((f, i) => {
    for (const [a, b] of OUTLIER_LIMBS) {
      const m = lengths[limbKey(a, b)];
      if (m > 0 && Math.abs(dist(f[a], f[b]) - m) / m > settings.outlierThreshold) {
        valid[i][b] = false;
        outlier[i] = true;
      }
    }
  });
  if (outlier.some(Boolean)) fillGaps(times, valid, world, image);

  // Zero-lag One Euro smoothing per coordinate.
  for (let l = 0; l < LANDMARK_COUNT; l++) {
    for (let c = 0; c < 3; c++) {
      const s = oneEuroSeries(
        world.map((f) => f[l][c]),
        MMD_FPS,
        settings.minCutoff,
        settings.beta,
      );
      s.forEach((v, i) => (world[i][l][c] = v));
    }
    for (let c = 0; c < 2; c++) {
      const s = oneEuroSeries(
        image.map((f) => f[l][c]),
        MMD_FPS,
        settings.minCutoff,
        settings.beta,
      );
      s.forEach((v, i) => (image[i][l][c] = v));
    }
  }

  // Bone-length normalisation: re-place each child along its direction at the median length.
  const limbLengths: Record<string, number> = {};
  for (const [a, b] of LIMBS) limbLengths[limbKey(a, b)] = median(world.map((f) => dist(f[a], f[b])));
  for (const f of world) {
    for (const [a, b] of LIMBS) {
      const len = limbLengths[limbKey(a, b)];
      if (len > 0) f[b] = add(f[a], scale(normalize(sub(f[b], f[a])), len));
    }
  }
  limbLengths.hipWidth = median(world.map((f) => dist(f[LM.leftHip], f[LM.rightHip])));
  limbLengths.torso = median(
    world.map((f) => dist(mid(f[LM.leftHip], f[LM.rightHip]), mid(f[LM.leftShoulder], f[LM.rightShoulder]))),
  );

  return {
    fps: MMD_FPS,
    frameCount: times.length,
    times,
    world,
    image,
    visibility,
    detected,
    outlier,
    missingLandmarks,
    limbLengths,
    imageSize: seq.analysedSize,
    jitterRaw,
    jitterClean: jitterScore(world),
  };
}

// Time sync of two views: by audio (onset envelopes, a clap gives a sharp peak) or by motion (vertical hip
// velocity). Convention everywhere: side time = front time + offset.
import { LM } from '@/engine/video2vmd/landmarks';
import type { PoseFrame } from '@/engine/video2vmd/types';

export interface SyncResult {
  /** Seconds; side time = front time + offset. */
  offset: number;
  /** 0..1. */
  confidence: number;
  /** Peak normalised correlation. */
  peak: number;
}

/** Onset envelope: half-wave rectified first difference of log RMS energy, one value per hop. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, hop = 0.01): Float32Array {
  const step = Math.max(1, Math.round(sampleRate * hop));
  const n = Math.floor(samples.length / step);
  const env = new Float32Array(n);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let i = k * step; i < (k + 1) * step; i++) e += samples[i] * samples[i];
    const l = Math.log(1e-8 + Math.sqrt(e / step));
    env[k] = k === 0 ? 0 : Math.max(0, l - prev);
    prev = l;
  }
  return env;
}

const zNorm = (a: ArrayLike<number>): Float64Array => {
  const n = a.length || 1;
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= n;
  let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - m) ** 2;
  const sd = Math.sqrt(v / n) || 1;
  return Float64Array.from(a, (x) => (x - m) / sd);
};

/**
 * Normalised cross-correlation c(L) = Σ_i a[i]·b[i + L] / min(|a|, |b|) for L in [−maxLag, maxLag] (both z-normalised).
 * The best lag (with parabolic sub-sample refinement) is where b lags a.
 */
export function crossCorrelate(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  maxLag: number,
  minOverlap = 0.25,
  /** Penalty per unit |lag| / maxLag (prefers small offsets when repetitive motion is ambiguous). */
  lagPenalty = 0,
): { lag: number; peak: number; second: number; curve: Float64Array } {
  const A = zNorm(a);
  const B = zNorm(b);
  const curve = new Float64Array(2 * maxLag + 1).fill(-Infinity);
  const minN = Math.max(4, Math.floor(Math.min(A.length, B.length) * minOverlap));
  const full = Math.max(1, Math.min(A.length, B.length));
  for (let L = -maxLag; L <= maxLag; L++) {
    let s = 0;
    let n = 0;
    const i0 = Math.max(0, -L);
    const i1 = Math.min(A.length, B.length - L);
    for (let i = i0; i < i1; i++) {
      s += A[i] * B[i + L];
      n++;
    }
    // Divided by the full length, not the overlap: short overlaps can't fake a high score.
    if (n >= minN) curve[L + maxLag] = s / full - (lagPenalty * Math.abs(L)) / Math.max(1, maxLag);
  }
  let best = 0;
  for (let i = 1; i < curve.length; i++) if (curve[i] > curve[best]) best = i;
  // Second-best peak at least 10 % of the search range (or 5 samples) away.
  const guard = Math.max(5, Math.round(maxLag * 0.1));
  let second = -Infinity;
  for (let i = 0; i < curve.length; i++)
    if (Math.abs(i - best) > guard && curve[i] > second) second = curve[i];
  let frac = 0;
  if (
    best > 0 &&
    best < curve.length - 1 &&
    Number.isFinite(curve[best - 1]) &&
    Number.isFinite(curve[best + 1])
  ) {
    const y0 = curve[best - 1];
    const y1 = curve[best];
    const y2 = curve[best + 1];
    const d = y0 - 2 * y1 + y2;
    if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d));
  }
  return { lag: best - maxLag + frac, peak: curve[best], second, curve };
}

const confidenceOf = (peak: number, second: number): number => {
  if (!Number.isFinite(peak) || peak <= 0) return 0;
  const distinct = Number.isFinite(second) ? Math.max(0, (peak - Math.max(0, second)) / peak) : 1;
  return Math.max(0, Math.min(1, Math.min(1, peak * 5) * Math.min(1, distinct * 1.4)));
};

/** Audio sync of two mono tracks (any sample rates). */
export function audioSync(
  front: { samples: Float32Array; sampleRate: number },
  side: { samples: Float32Array; sampleRate: number },
  maxOffset = 10,
): SyncResult {
  const hop = 0.01;
  const a = onsetEnvelope(front.samples, front.sampleRate, hop);
  const b = onsetEnvelope(side.samples, side.sampleRate, hop);
  const maxLag = Math.min(Math.round(maxOffset / hop), Math.max(a.length, b.length));
  const r = crossCorrelate(a, b, maxLag, 0.2);
  return { offset: r.lag * hop, confidence: confidenceOf(r.peak, r.second), peak: r.peak };
}

/** Vertical hip velocity (image y of the hip midpoint ÷ torso length, per second) on a uniform grid. */
export function hipVelocity(frames: PoseFrame[], fps: number): { start: number; values: Float64Array } {
  if (!frames.length) return { start: 0, values: new Float64Array(0) };
  const start = frames[0].time;
  const end = frames[frames.length - 1].time;
  const n = Math.max(2, Math.floor((end - start) * fps) + 1);
  const pos = new Float64Array(n);
  let j = 0;
  let last = 0;
  for (let k = 0; k < n; k++) {
    const t = start + k / fps;
    while (j + 1 < frames.length && frames[j + 1].time <= t) j++;
    const f = frames[j];
    if (f.detected) {
      const hy = (f.image[LM.leftHip * 4 + 1] + f.image[LM.rightHip * 4 + 1]) / 2;
      const sy = (f.image[LM.leftShoulder * 4 + 1] + f.image[LM.rightShoulder * 4 + 1]) / 2;
      const torso = Math.max(0.02, Math.abs(hy - sy));
      last = hy / torso;
    }
    pos[k] = last;
  }
  const v = new Float64Array(n);
  for (let k = 1; k < n; k++) v[k] = (pos[k] - pos[k - 1]) * fps;
  v[0] = v[1] ?? 0;
  return { start, values: v };
}

/** Motion sync from the two pose tracks (the fallback when the audio is missing or ambiguous). */
export function motionSync(front: PoseFrame[], side: PoseFrame[], fps = 30, maxOffset = 10): SyncResult {
  const a = hipVelocity(front, fps);
  const b = hipVelocity(side, fps);
  const maxLag = Math.min(Math.round(maxOffset * fps), Math.max(a.values.length, b.values.length));
  const r = crossCorrelate(a.values, b.values, maxLag, 0.3, 0.05);
  // b[i + lag] ↔ a[i]: side grid time (b.start + (i + lag)/fps) matches front time (a.start + i/fps).
  return {
    offset: b.start - a.start + r.lag / fps,
    confidence: confidenceOf(r.peak, r.second),
    peak: r.peak,
  };
}

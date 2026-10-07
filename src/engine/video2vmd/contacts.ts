import type { Vec3 } from './math';

export interface ContactOptions {
  /** Height above the floor (same units as positions) below which a foot may be in contact. */
  heightThreshold: number;
  /** Horizontal speed (units per second) below which a foot may be in contact. */
  speedThreshold: number;
  fps: number;
  /** Shortest contact kept (frames). */
  minContactFrames?: number;
  /** Shortest non-contact gap kept (frames); shorter gaps are bridged. */
  minGapFrames?: number;
}

/**
 * Foot contacts from a foot height track (height above the floor) and horizontal positions.
 * Uses hysteresis (enter below 70 % of the thresholds, leave above them) and removes flickers.
 */
export function detectContacts(height: number[], positions: Vec3[], o: ContactOptions): boolean[] {
  const n = height.length;
  const speed = positions.map((_, i) => {
    const a = positions[Math.max(0, i - 1)];
    const b = positions[Math.min(n - 1, i + 1)];
    const span = Math.min(n - 1, i + 1) - Math.max(0, i - 1);
    return span > 0 ? (Math.hypot(b[0] - a[0], b[2] - a[2]) / span) * o.fps : 0;
  });
  const out = new Array<boolean>(n).fill(false);
  let inContact = false;
  for (let i = 0; i < n; i++) {
    const enter = height[i] < o.heightThreshold * 0.7 && speed[i] < o.speedThreshold * 0.7;
    const stay = height[i] < o.heightThreshold && speed[i] < o.speedThreshold;
    inContact = inContact ? stay : enter;
    out[i] = inContact;
  }
  bridge(out, false, o.minGapFrames ?? 2);
  bridge(out, true, o.minContactFrames ?? 3);
  return out;
}

/** Flip runs of `value` shorter than `min` frames (only interior runs for gaps). */
function bridge(flags: boolean[], value: boolean, min: number): void {
  let i = 0;
  while (i < flags.length) {
    if (flags[i] !== value) {
      i++;
      continue;
    }
    let j = i;
    while (j < flags.length && flags[j] === value) j++;
    const interior = i > 0 && j < flags.length;
    if (j - i < min && (value || interior)) for (let k = i; k < j; k++) flags[k] = !value;
    i = j;
  }
}

/** Contact runs as [start, end] inclusive frame ranges. */
export function contactRuns(flags: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let s = -1;
  flags.forEach((f, i) => {
    if (f && s < 0) s = i;
    if (!f && s >= 0) {
      runs.push([s, i - 1]);
      s = -1;
    }
  });
  if (s >= 0) runs.push([s, flags.length - 1]);
  return runs;
}

/**
 * Pin the horizontal position of a foot during each contact run (removes foot skating), blending in and
 * out over `blend` frames. Height is kept.
 */
export function pinFeet(positions: Vec3[], flags: boolean[], blend = 3): Vec3[] {
  const out = positions.map((p): Vec3 => [...p]);
  const n = positions.length;
  const weight = new Array<number>(n).fill(0);
  const pin: (Vec3 | null)[] = new Array(n).fill(null);
  for (const [s, e] of contactRuns(flags)) {
    // Anchor on the average of the first frames of the contact (the moment the foot lands).
    const m = Math.min(e, s + 2);
    let x = 0;
    let z = 0;
    for (let i = s; i <= m; i++) {
      x += positions[i][0];
      z += positions[i][2];
    }
    const anchor: Vec3 = [x / (m - s + 1), 0, z / (m - s + 1)];
    for (let i = Math.max(0, s - blend); i <= Math.min(n - 1, e + blend); i++) {
      const w = i < s ? 1 - (s - i) / (blend + 1) : i > e ? 1 - (i - e) / (blend + 1) : 1;
      if (w > weight[i]) {
        weight[i] = w;
        pin[i] = anchor;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const a = pin[i];
    if (!a) continue;
    out[i][0] += (a[0] - out[i][0]) * weight[i];
    out[i][2] += (a[2] - out[i][2]) * weight[i];
  }
  return out;
}

/** Mean horizontal speed (units per second) over contact frames. */
export function footSkate(positions: Vec3[], flags: boolean[], fps: number): number {
  let sum = 0;
  let count = 0;
  for (let i = 1; i < positions.length; i++) {
    if (!flags[i] || !flags[i - 1]) continue;
    sum += Math.hypot(positions[i][0] - positions[i - 1][0], positions[i][2] - positions[i - 1][2]) * fps;
    count++;
  }
  return count ? sum / count : 0;
}

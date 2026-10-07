/**
 * VMD cubic bezier interpolation, identical to babylon-mmd's `BezierInterpolate` (bisection on x, then y),
 * so editor previews match playback exactly. Control points are in 0..1 (bytes / 127).
 */
export function bezierWeight(x1: number, x2: number, y1: number, y2: number, x: number): number {
  let c = 0.5;
  let t = c;
  let s = 1 - t;
  let sst3 = 0;
  let stt3 = 0;
  let ttt = 0;
  for (let i = 0; i < 15; ++i) {
    sst3 = 3 * s * s * t;
    stt3 = 3 * s * t * t;
    ttt = t * t * t;
    const ft = sst3 * x1 + stt3 * x2 + ttt - x;
    if (Math.abs(ft) < 1e-5) break;
    c *= 0.5;
    t += ft < 0 ? c : -c;
    s = 1 - t;
  }
  return sst3 * y1 + stt3 * y2 + ttt;
}

/** Weight for channel `ch` of a curve array (`x1, y1, x2, y2` bytes per channel). */
export function curveWeight(ip: ArrayLike<number>, ch: number, x: number): number {
  const o = ch * 4;
  return bezierWeight(ip[o] / 127, ip[o + 2] / 127, ip[o + 1] / 127, ip[o + 3] / 127, x);
}

export type CurvePreset = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';

/** `x1, y1, x2, y2` bytes for a preset. "step" holds the start value until the next key. */
export const CURVE_PRESETS: Record<CurvePreset, [number, number, number, number]> = {
  linear: [20, 20, 107, 107],
  'ease-in': [64, 0, 107, 107],
  'ease-out': [20, 20, 64, 127],
  'ease-in-out': [64, 0, 64, 127],
  step: [127, 0, 127, 0],
};

/** Clamp a control byte. */
export const clampByte = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));

/** Replace channel curves with a preset (channels default to all). */
export function applyPreset(ip: number[], preset: CurvePreset, channels?: number[]): number[] {
  const out = [...ip];
  const p = CURVE_PRESETS[preset];
  const chs = channels ?? Array.from({ length: ip.length / 4 }, (_, i) => i);
  for (const ch of chs) out.splice(ch * 4, 4, ...p);
  return out;
}

/** Name the preset a curve matches, if any. */
export function presetOf(ip: ArrayLike<number>, ch: number): CurvePreset | null {
  const o = ch * 4;
  for (const [name, p] of Object.entries(CURVE_PRESETS) as [CurvePreset, number[]][]) {
    if (p.every((v, i) => ip[o + i] === v)) return name;
  }
  return null;
}

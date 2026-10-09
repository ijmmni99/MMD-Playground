// Hand pose representation shared by the synthetic fixture, finger retargeting and the preset classifier.
import type { Finger } from './types';

/**
 * Per-finger joint angles in degrees. For the four fingers `flex` = [MCP, PIP, DIP] and `spread` is the
 * sideways angle of the proximal segment in the palm plane (positive = toward the thumb). For the thumb
 * `flex` = [opposition (CMC, out of the palm plane), MCP, IP] and `spread` is unused.
 */
export interface FingerPose {
  flex: [number, number, number];
  spread: number;
}
export type HandPose = Record<Finger, FingerPose>;

const f = (a: number, b: number, c: number, spread = 0): FingerPose => ({ flex: [a, b, c], spread });

export type HandPresetId = 'open' | 'relaxed' | 'fist' | 'point' | 'peace';

export const HAND_PRESETS: Record<HandPresetId, HandPose> = {
  open: {
    thumb: f(10, 5, 5),
    index: f(4, 4, 3, 8),
    middle: f(4, 4, 3),
    ring: f(4, 4, 3, -6),
    little: f(4, 4, 3, -12),
  },
  relaxed: {
    thumb: f(20, 15, 10),
    index: f(18, 28, 14, 4),
    middle: f(22, 32, 16),
    ring: f(26, 36, 18, -3),
    little: f(30, 40, 20, -6),
  },
  fist: {
    thumb: f(45, 45, 40),
    index: f(85, 100, 60),
    middle: f(85, 100, 60),
    ring: f(85, 100, 60),
    little: f(85, 100, 60),
  },
  point: {
    thumb: f(45, 45, 40),
    index: f(4, 4, 3),
    middle: f(85, 100, 60),
    ring: f(85, 100, 60),
    little: f(85, 100, 60),
  },
  peace: {
    thumb: f(45, 45, 40),
    index: f(4, 4, 3, 10),
    middle: f(4, 4, 3, -8),
    ring: f(85, 100, 60),
    little: f(85, 100, 60),
  },
};

export const PRESET_LABEL: Record<HandPresetId, string> = {
  open: 'Open',
  relaxed: 'Relaxed',
  fist: 'Fist',
  point: 'Point',
  peace: 'Peace',
};

export function lerpHandPose(a: HandPose, b: HandPose, t: number): HandPose {
  const out = {} as HandPose;
  for (const k of Object.keys(a) as Finger[]) {
    out[k] = {
      flex: a[k].flex.map((v, i) => v + (b[k].flex[i] - v) * t) as [number, number, number],
      spread: a[k].spread + (b[k].spread - a[k].spread) * t,
    };
  }
  return out;
}

export const cloneHandPose = (p: HandPose): HandPose => lerpHandPose(p, p, 0);

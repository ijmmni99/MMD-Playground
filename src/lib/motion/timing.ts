import { FPS, type Marker, type TimingGrid } from './types';

export const DEFAULT_GRID: TimingGrid = { bpm: 0, offset: 0, beatsPerBar: 4 };

/** Frames per beat at a BPM (30 fps). */
export const framesPerBeat = (bpm: number): number => (bpm > 0 ? (60 / bpm) * FPS : 0);

/** Beat frames (fractional) within [from, to]. */
export function beatFrames(grid: TimingGrid, from: number, to: number): { f: number; bar: boolean }[] {
  const step = framesPerBeat(grid.bpm);
  if (!(step > 0)) return [];
  const out: { f: number; bar: boolean }[] = [];
  const first = Math.ceil((from - grid.offset) / step);
  for (let i = first; ; i++) {
    const f = grid.offset + i * step;
    if (f > to) break;
    if (f >= from) out.push({ f, bar: ((i % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0 });
    if (out.length > 100000) break;
  }
  return out;
}

export interface SnapOptions {
  grid?: TimingGrid;
  markers?: readonly Marker[];
  /** Snap to beats / markers within this many frames. */
  radius?: number;
}

/** Snap a frame: always to whole frames, then to the nearest beat or marker within `radius`. */
export function snapFrame(f: number, o: SnapOptions = {}): number {
  const whole = Math.max(0, Math.round(f));
  const radius = o.radius ?? 0;
  if (radius <= 0) return whole;
  let best = whole;
  let bestD = radius + 1e-9;
  const consider = (c: number): void => {
    const d = Math.abs(c - f);
    if (d <= bestD) {
      bestD = d;
      best = Math.max(0, Math.round(c));
    }
  };
  if (o.grid && o.grid.bpm > 0) {
    const step = framesPerBeat(o.grid.bpm);
    const i = Math.round((f - o.grid.offset) / step);
    consider(o.grid.offset + i * step);
  }
  for (const m of o.markers ?? []) consider(m.f);
  return best;
}

/** BPM from tap timestamps (ms), using the median interval of the last taps. */
export function bpmFromTaps(times: readonly number[]): number {
  if (times.length < 2) return 0;
  const recent = times.slice(-9);
  const gaps = recent
    .slice(1)
    .map((t, i) => t - recent[i])
    .filter((g) => g > 150 && g < 2000);
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  return Math.round((60000 / median) * 10) / 10;
}

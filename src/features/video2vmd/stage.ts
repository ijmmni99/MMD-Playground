import type { PoseFrame, PoseSequence } from '@/engine/video2vmd/types';

/** The stages' <video> elements, for trim controls that read or set the current time. */
export const stageVideo: { current: HTMLVideoElement | null } = { current: null };
export const stageVideoSide: { current: HTMLVideoElement | null } = { current: null };

/** Pose frame nearest to a source time (binary search). */
export function frameAt(seq: PoseSequence, time: number): PoseFrame | null {
  const f = seq.frames;
  if (!f.length) return null;
  let lo = 0;
  let hi = f.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (f[m].time <= time) lo = m;
    else hi = m;
  }
  const best = Math.abs(f[hi].time - time) < Math.abs(f[lo].time - time) ? f[hi] : f[lo];
  return Math.abs(best.time - time) < 0.25 ? best : null;
}

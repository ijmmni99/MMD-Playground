import { me } from '@/store/motionEditor';

/** Fit the dope-sheet view to frames 0..end ("frame all"). */
export function frameAll(end: number): void {
  me.set({ view: { start: -2, span: Math.max(60, end + 12) } });
}

/** Test/automation probe: client coordinates of a key in the dope sheet (set while it is mounted). */
export const dopeProbe: { keyPoint?: (track: string, f: number) => { x: number; y: number } | null } = {};

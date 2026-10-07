import { clipEndFrame } from '@/lib/motion/evaluate';
import { engineOrNull } from '@/store/engineRef';
import { me } from '@/store/motionEditor';

/** Fit the dope-sheet view to frames 0..end ("frame all"). */
export function frameAll(end: number): void {
  me.set({ view: { start: -2, span: Math.max(60, end + 12) } });
}

/** Test/automation probe: client coordinates of a key in the dope sheet (set while it is mounted). */
export const dopeProbe: {
  /** Pixels per frame of the dope sheet (the graph editor matches it so frames line up). */
  ppf?: number;
  keyPoint?: (track: string, f: number) => { x: number; y: number } | null;
} = {};

/** Length of everything being edited (frames). */
export function editedEnd(): number {
  const s = me.get();
  const clip = s.modelId ? s.clips[s.modelId] : null;
  return Math.max(clip ? clipEndFrame(clip) : 0, s.camera ? clipEndFrame(s.camera) : 0);
}

/** The tool range: explicit range, else the selected keys' span, else the whole clip. */
export function toolRange(): [number, number] {
  const s = me.get();
  if (s.range) return s.range;
  const frames = [...s.selection].map((id) => Number(id.split('\u0000')[2]));
  if (frames.length > 1) return [Math.min(...frames), Math.max(...frames)];
  return [0, editedEnd()];
}

export const playhead = (): number => Math.round(engineOrNull()?.getPlayback().frame ?? 0);

import { create } from 'zustand';
import { emptyTimeline, type Clip, type TimelineDoc } from '@/lib/clips/types';

export interface ClipTimelineState {
  /** The Clips view is showing in the bottom dock. */
  open: boolean;
  doc: TimelineDoc;
  /** Selected clip ids. */
  selection: string[];
  /** Pixels per frame. */
  ppf: number;
  /** Frame at the left edge of the tracks (free-playhead mode). */
  scroll: number;
  /** Fixed center playhead with a scrolling timeline (phones / tablets) vs a free playhead. */
  centerPlayhead: boolean;
  snap: boolean;
  clipboard: Clip[];
  /** Document when this session started (Revert). */
  sessionStart: TimelineDoc | null;
  /** A clip open in the keyframe editor (Advanced view). */
  editing: { clipId: string; sourceId: string; modelId: string | null } | null;
  /** Bumped when runtime sources (parsed motions, waveforms) change. */
  sourcesRevision: number;
  /** Text clip whose properties are being edited. */
  textEditing: string | null;
  /** 3D text detail: auto follows the render quality (and steps down when the frame rate drops). */
  textQuality: 'auto' | 'low' | 'medium' | 'high';
  /** Characters no font could draw, per text clip. */
  textMissing: Record<string, string[]>;
}

export const useClipTimeline = create<ClipTimelineState>(() => ({
  open: false,
  doc: emptyTimeline(),
  selection: [],
  ppf: 4,
  scroll: 0,
  centerPlayhead: false,
  snap: true,
  clipboard: [],
  sessionStart: null,
  editing: null,
  sourcesRevision: 0,
  textEditing: null,
  textQuality: 'auto',
  textMissing: {},
}));

export const ct = { get: useClipTimeline.getState, set: useClipTimeline.setState };

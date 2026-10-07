import { create } from 'zustand';
import type { Clipboard } from '@/lib/motion/edit';
import { DEFAULT_GRID } from '@/lib/motion/timing';
import type { KeyRef, Marker, MotionClip, PinRange, Shot, TimingGrid } from '@/lib/motion/types';
import type { FileRef } from '@/lib/project';

/** A graph-editor channel: one curve of one track. */
export interface ChannelRef {
  kind: KeyRef['kind'];
  track: string;
  /** Bones: 0–2 position X/Y/Z, 3 rotation. Camera: 0–2 target, 3 rotation, 4 distance, 5 FOV. Morph: 0. */
  channel: number;
}

export interface MotionEditorState {
  /** Editor tab is showing (bottom dock). */
  open: boolean;
  /** Model whose motion is edited (null = camera only). */
  modelId: string | null;
  /** Edited clips per model (base, before pins). */
  clips: Record<string, MotionClip>;
  /** Clips as originally loaded (revert / A-B compare). */
  originals: Record<string, MotionClip>;
  /** File name of the motion per model (for export names). */
  names: Record<string, string>;
  camera: MotionClip | null;
  cameraOriginal: MotionClip | null;
  cameraName: string;
  pins: Record<string, PinRange[]>;
  markers: Marker[];
  grid: TimingGrid;
  shots: Shot[];
  /** Selected keys (keyId strings). */
  selection: Set<string>;
  channel: ChannelRef | null;
  autoKey: boolean;
  /** When keying an IK bone, also key the solved FK chain. */
  bakeFk: boolean;
  snapToBeats: boolean;
  /** Show the original (unedited) motion. */
  compareOriginal: boolean;
  graphOpen: boolean;
  directorOpen: boolean;
  pip: boolean;
  cameraPath: boolean;
  ikOverlay: boolean;
  /** Models whose IK solvers are switched off (FK posing / debug). */
  ikOff: Record<string, boolean>;
  /** Collapsed dope-sheet groups. */
  collapsed: Record<string, boolean>;
  /** Tool range [from, to] (inclusive), null = whole clip. Shift-drag on the ruler sets it. */
  range: [number, number] | null;
  /** Visible frame range of the dope sheet. */
  view: { start: number; span: number };
  clipboard: Clipboard | null;
  /** Stored blobs for persistence (filled by autosave). */
  saved: { models: Record<string, { base: FileRef; original: FileRef }>; camera: { base: FileRef; original: FileRef } | null };
  /** Bumped on every clip change (cheap change detection for canvases). */
  revision: number;
}

export const useMotionEditor = create<MotionEditorState>(() => ({
  open: false,
  modelId: null,
  clips: {},
  originals: {},
  names: {},
  camera: null,
  cameraOriginal: null,
  cameraName: 'camera.vmd',
  pins: {},
  markers: [],
  grid: { ...DEFAULT_GRID },
  shots: [],
  selection: new Set(),
  channel: null,
  autoKey: false,
  bakeFk: true,
  snapToBeats: true,
  compareOriginal: false,
  graphOpen: false,
  directorOpen: false,
  pip: false,
  cameraPath: false,
  ikOverlay: false,
  ikOff: {},
  collapsed: { fingers: true, other: true },
  range: null,
  view: { start: 0, span: 300 },
  clipboard: null,
  saved: { models: {}, camera: null },
  revision: 0,
}));

export const me = { get: useMotionEditor.getState, set: useMotionEditor.setState };

/**
 * Hooks the studio core calls into (set by the editor module when loaded), so core code never imports
 * the editor: auto-key on gizmo / morph edits.
 */
export const motionHooks: {
  boneEdited?: (modelId: string, bone: number) => void;
  morphChanged?: (modelId: string, name: string, weight: number) => void;
  /** A new motion file was assigned to a model (modelId) or the camera ('__camera__'). */
  motionReplaced?: (target: string) => void;
} = {};

/** Saved with the project. */
export interface MotionEditorDoc {
  models: Record<string, { base: FileRef; original: FileRef; pins: PinRange[]; name: string }>;
  camera: { base: FileRef; original: FileRef; name: string } | null;
  markers: Marker[];
  grid: TimingGrid;
  shots: Shot[];
}

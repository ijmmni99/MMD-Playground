// Clip timeline data model. Clips reference source motions (never copy or edit their keys); the
// timeline is baked into ordinary MotionClips for playback and export.

export type TrackKind = 'dance' | 'camera' | 'face' | 'audio' | 'text';
export type SourceKind = 'motion' | 'camera' | 'face' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  /** Dance / face tracks drive one model. */
  modelId?: string;
  name: string;
}

export interface SourceRef {
  blobId: string;
  path: string;
}

export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  /** Stored file (VMD / audio); absent for generated sources until saved. */
  ref?: SourceRef;
  /** Length in frames (last key frame / audio duration). */
  length: number;
}

export type RootMode = 'continue' | 'origin';

export interface Join {
  /** Crossfade frames from the previous clip on the track (0 = hard switch). */
  fade: number;
  /** Dance: continue from where the previous clip ended, or keep the source placement. */
  root: RootMode;
  /** Camera: hard cut (MMD consecutive-frame keys) instead of a blend. */
  cut: boolean;
}

export const DEFAULT_JOIN: Join = { fade: 8, root: 'continue', cut: true };

// ---------------------------------------------------------------- text

export type TextStylePreset = 'solid' | 'glossy' | 'neon' | 'gradient' | 'outline' | 'glass';
export type TextPlacement = 'fixed' | 'billboard' | 'bone' | 'caption';
export type TextInAnim = 'none' | 'fade' | 'pop' | 'slide' | 'typewriter' | 'wave' | 'spin' | 'drop';
export type TextIdleAnim = 'none' | 'float' | 'pulse' | 'wobble';
export type TextAlign = 'left' | 'center' | 'right';

export interface TextSpec {
  content: string;
  /** Font id: a bundled font name or a user font source id. */
  font: string;
  /** Glyph height (model units; ~ cap height). */
  size: number;
  letterSpacing: number;
  lineSpacing: number;
  align: TextAlign;
  depth: number;
  bevel: number;
  color: string;
  /** Second color (gradient bottom / outline). */
  color2: string;
  style: TextStylePreset;
  placement: TextPlacement;
  /** Fixed / billboard position, or the offset from the bone. */
  position: [number, number, number];
  /** Euler degrees (fixed placement). */
  rotation: [number, number, number];
  scale: number;
  /** Bone placement. */
  modelId?: string;
  bone?: string;
  animIn: TextInAnim;
  animInFrames: number;
  animOut: TextInAnim;
  animOutFrames: number;
  idle: TextIdleAnim;
  castShadow: boolean;
  /** Render over everything (ignore depth). */
  onTop: boolean;
}

export const DEFAULT_TEXT: TextSpec = {
  content: 'Hello / こんにちは',
  font: 'Noto Sans JP',
  size: 1.6,
  letterSpacing: 0,
  lineSpacing: 1.2,
  align: 'center',
  depth: 0.3,
  bevel: 0.03,
  color: '#ffffff',
  color2: '#6d8bff',
  style: 'glossy',
  placement: 'billboard',
  position: [0, 22, 0],
  rotation: [0, 0, 0],
  scale: 1,
  animIn: 'pop',
  animInFrames: 12,
  animOut: 'fade',
  animOutFrames: 10,
  idle: 'none',
  castShadow: false,
  onTop: false,
};

// ---------------------------------------------------------------- clips

export interface Clip {
  id: string;
  trackId: string;
  /** Source motion / audio (text clips have none). */
  sourceId?: string;
  /** Source frame range [sourceIn, sourceOut). */
  sourceIn: number;
  sourceOut: number;
  startFrame: number;
  /** Playback speed (0.25–4). */
  speed: number;
  mirror: boolean;
  loopCount: number;
  join: Join;
  /** Audio clip volume 0–1. */
  volume?: number;
  /** Text clip: its length in frames (no source). */
  length?: number;
  text?: TextSpec;
}

export interface TimelineDoc {
  version: 1;
  tracks: Track[];
  clips: Clip[];
  sources: Source[];
  /** Shared style for subtitle / lyrics clips. */
  textStyle: TextSpec;
  /** User-uploaded fonts (family name → stored file). */
  fonts?: UserFont[];
}

export interface UserFont {
  family: string;
  ref: { blobId: string; path: string };
}

export const emptyTimeline = (): TimelineDoc => ({
  version: 1,
  tracks: [],
  clips: [],
  sources: [],
  textStyle: {
    ...DEFAULT_TEXT,
    content: '',
    placement: 'caption',
    style: 'outline',
    animIn: 'fade',
    animOut: 'fade',
  },
});

export const SPEED_RANGE: [number, number] = [0.25, 4];

/** Length of the source range at speed 1. */
export const sourceSpan = (c: Clip): number => Math.max(1, c.sourceOut - c.sourceIn);

/** Frames one pass of the clip occupies on the timeline. */
export const passLength = (c: Clip): number =>
  c.text || c.sourceId === undefined
    ? Math.max(1, c.length ?? 1)
    : Math.max(1, Math.round(sourceSpan(c) / c.speed));

/** Timeline length of a clip (all loops). */
export const clipLength = (c: Clip): number => passLength(c) * (c.text ? 1 : Math.max(1, c.loopCount));

/** Last frame the clip covers (its end pose sits here). */
export const clipEnd = (c: Clip): number => c.startFrame + clipLength(c);

// Editable motion data model. Immutable by convention: edits return new objects and only replace the
// tracks they touch, so undo snapshots are cheap references and the engine can cache built tracks.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** VMD frames run at 30 fps. */
export const FPS = 30;

/**
 * Interpolation curves, each `x1, y1, x2, y2` as bytes 0–127 (VMD control points).
 * Bones: 16 numbers (channels X, Y, Z, rotation). Camera: 24 (X, Y, Z, rotation, distance, FOV).
 */
export type Curves = number[];

export interface BoneKey {
  f: number;
  /** Translation offset from the rest position (VMD position). */
  p: Vec3;
  /** Local rotation quaternion. */
  r: Quat;
  ip: Curves;
  /**
   * Raw physics toggle from bytes 2–3 of the VMD interpolation block (0 = physics on, the default;
   * 0x630F = off). Kept verbatim so files round-trip exactly.
   */
  phys?: number;
}

export interface BoneTrack {
  name: string;
  keys: BoneKey[];
}

export interface MorphKey {
  f: number;
  w: number;
}

export interface MorphTrack {
  name: string;
  keys: MorphKey[];
}

export interface PropertyKey {
  f: number;
  visible: boolean;
  /** IK bone name → enabled. */
  ik: Record<string, boolean>;
}

export interface CameraKey {
  f: number;
  /** Look-at target (VMD "position"). */
  t: Vec3;
  /** Euler rotation in radians (VMD order). */
  r: Vec3;
  /** Distance from the target (negative = in front, MMD default -45). */
  d: number;
  /** Field of view in degrees (integer in VMD). */
  fov: number;
  /** Perspective on (VMD flag; 0 = orthographic in MMD). */
  persp: boolean;
  ip: Curves;
}

export interface LightKey {
  f: number;
  color: Vec3;
  dir: Vec3;
}

export interface ShadowKey {
  f: number;
  mode: number;
  dist: number;
}

/** Everything one VMD file holds. Sections a target doesn't use are kept so export round-trips. */
export interface MotionClip {
  /** Model name from the VMD header. */
  modelName: string;
  bones: BoneTrack[];
  morphs: MorphTrack[];
  props: PropertyKey[];
  camera: CameraKey[];
  lights: LightKey[];
  shadows: ShadowKey[];
}

export const emptyClip = (modelName = ''): MotionClip => ({
  modelName,
  bones: [],
  morphs: [],
  props: [],
  camera: [],
  lights: [],
  shadows: [],
});

/** Linear interpolation (MMD default control points). */
export const LINEAR: readonly number[] = [20, 20, 107, 107];
export const linearCurves = (channels: number): Curves =>
  Array.from({ length: channels * 4 }, (_, i) => LINEAR[i % 4]);

export const BONE_CHANNELS = 4;
export const CAMERA_CHANNELS = 6;

// ---------------------------------------------------------------- editor metadata

export interface Marker {
  id: string;
  f: number;
  name: string;
}

export interface Shot {
  id: string;
  name: string;
  start: number;
  end: number;
  color: string;
  /** How this shot starts: hard cut (VMD consecutive-frame keys) or blended from the previous shot. */
  transition: 'cut' | 'blend';
}

export interface PinRange {
  id: string;
  /** IK bone, e.g. 左足ＩＫ. */
  bone: string;
  start: number;
  end: number;
  blendIn: number;
  blendOut: number;
  /** IK target value captured when the pin was created; edits underneath don't move the planted foot. */
  anchor?: { p: Vec3; r: Quat };
}

export interface TimingGrid {
  /** Beats per minute (0 = off). */
  bpm: number;
  /** Frame of the first beat. */
  offset: number;
  /** Beats per bar (for bar lines). */
  beatsPerBar: number;
}

/** Reference to one key in the editor: kind + track name + frame. */
export interface KeyRef {
  kind: 'bone' | 'morph' | 'camera';
  track: string;
  f: number;
}

export const keyId = (k: KeyRef): string => `${k.kind}\u0000${k.track}\u0000${k.f}`;
export const parseKeyId = (id: string): KeyRef => {
  const [kind, track, f] = id.split('\u0000');
  return { kind: kind as KeyRef['kind'], track, f: Number(f) };
};

/** Name used for the camera track in selections. */
export const CAMERA_TRACK = '__camera__';

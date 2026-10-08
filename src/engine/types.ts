// Plain data types shared between the engine and the UI. No Babylon imports here.

export type Vec3 = [number, number, number];

export type QualityPreset = 'low' | 'medium' | 'high';
export type CameraMode = 'orbit' | 'fly' | 'vmd';
export type BackgroundMode = 'solid' | 'gradient' | 'hdr' | 'transparent';
export type ToneMapping = 'none' | 'standard' | 'aces' | 'khr';
export type MorphCategory = 'eyebrow' | 'eye' | 'mouth' | 'other' | 'system';

/** A file inside the virtual file system built from drops, pickers and ZIPs. */
export interface VFile {
  /** Normalised forward-slash path relative to the drop root, e.g. "Miku/tex/face.png". */
  path: string;
  blob: Blob;
}

export interface MorphInfo {
  index: number;
  name: string;
  /** English name from the PMX, if any (display only). */
  en?: string;
  category: MorphCategory;
}

export interface BoneInfo {
  index: number;
  name: string;
  /** English name from the PMX, if any (display only). */
  en?: string;
  parent: number;
  /** Has a rigid body driven by physics. */
  physics: boolean;
}

export interface MaterialInfo {
  index: number;
  name: string;
  /** English name from the PMX, if any (display only). */
  en?: string;
  visible: boolean;
  outline: boolean;
  alpha: number;
}

export interface TransformState {
  position: Vec3;
  /** Euler degrees. */
  rotation: Vec3;
  scale: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  fileName: string;
  morphs: MorphInfo[];
  bones: BoneInfo[];
  materials: MaterialInfo[];
  rigidBodyCount: number;
  missingTextures: string[];
  vertexCount: number;
}

export interface MotionInfo {
  name: string;
  frameCount: number;
  /** Keyframe frame numbers grouped for the timeline. */
  groups: { name: string; kind: 'bone' | 'morph'; frames: number[] }[];
}

export interface CameraMotionInfo {
  name: string;
  frameCount: number;
  frames: number[];
}

export interface AudioInfo {
  name: string;
  duration: number;
  /** Normalised peak envelope (0..1), ~200 samples per second. */
  peaks: number[];
  peaksPerSecond: number;
}

export interface LightingSettings {
  dirIntensity: number;
  dirColor: string;
  /** Azimuth in degrees (0 = from front). */
  dirAzimuth: number;
  /** Elevation in degrees. */
  dirElevation: number;
  ambientIntensity: number;
  ambientColor: string;
  groundColor: string;
  shadows: boolean;
  softShadows: boolean;
  shadowDarkness: number;
}

export interface BackgroundSettings {
  mode: BackgroundMode;
  color: string;
  gradientTop: string;
  gradientBottom: string;
  /** Id of the stored HDR/ENV blob, if any. */
  hdrName: string | null;
  hdrIntensity: number;
  showGround: boolean;
}

export interface PostFxSettings {
  bloom: boolean;
  bloomWeight: number;
  bloomThreshold: number;
  dof: boolean;
  dofFocusDistance: number;
  dofFStop: number;
  fxaa: boolean;
  toneMapping: ToneMapping;
  exposure: number;
  contrast: number;
  vignette: boolean;
  vignetteWeight: number;
  ssao: boolean;
  outlineScale: number;
}

export interface ViewportSettings {
  quality: QualityPreset;
  showGrid: boolean;
  showAxes: boolean;
  showStats: boolean;
}

export interface PhysicsSettings {
  enabled: boolean;
  gravity: number;
  /** Max substeps per frame. */
  substeps: number;
  fixedTimeStep: number;
}

export interface CameraState {
  mode: CameraMode;
  fov: number;
  /** Orbit target / fly position. */
  target: Vec3;
  alpha: number;
  beta: number;
  radius: number;
  follow: { modelId: string; bone: string } | null;
}

export interface SceneSettings {
  viewport: ViewportSettings;
  lighting: LightingSettings;
  background: BackgroundSettings;
  postfx: PostFxSettings;
  physics: PhysicsSettings;
}

export interface PlaybackState {
  playing: boolean;
  frame: number;
  duration: number;
  speed: number;
  loop: boolean;
}

export interface Stats {
  fps: number;
  drawCalls: number;
  activeMeshes: number;
  frameTimeMs: number;
}

export type CameraPreset = 'front' | 'back' | 'left' | 'right' | 'face' | 'full';

export interface PoseData {
  version: 1;
  model: string;
  bones: { name: string; rotation: [number, number, number, number]; position: Vec3 }[];
  morphs: Record<string, number>;
}

export interface ScreenshotOptions {
  width: number;
  height: number;
  transparent: boolean;
}

export interface RecordOptions {
  width: number;
  height: number;
  fps: number;
  mimeType: string;
  /** Step frames deterministically instead of realtime capture. */
  deterministic: boolean;
  startFrame: number;
  endFrame: number;
  includeAudio: boolean;
  bitrate: number;
}

export interface ModelRuntimeState {
  visible: boolean;
  physics: boolean;
  transform: TransformState;
  materials: { visible: boolean; outline: boolean; alpha: number }[];
  morphs: Record<string, number>;
  /** Scenery (MMD stage): never picked by taps, ignored for camera framing, hides the floor grid. */
  stage?: boolean;
}

/** Pseudo MIME type for the frame-stepped PNG-sequence ZIP export (no video encoder needed). */
export const PNG_SEQUENCE_MIME = 'application/x-png-sequence+zip';

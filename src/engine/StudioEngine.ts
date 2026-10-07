// Public, framework-agnostic engine contract. This module is tiny and does not import Babylon:
// the implementation is code-split and loaded on demand via `createStudioEngine`.
import type { MotionClip } from '@/lib/motion/types';
import type { Emitter } from './emitter';
import type {
  AudioInfo,
  CameraMode,
  CameraMotionInfo,
  CameraPreset,
  CameraState,
  ModelInfo,
  ModelRuntimeState,
  MotionInfo,
  PlaybackState,
  PoseData,
  RecordOptions,
  SceneSettings,
  ScreenshotOptions,
  Stats,
  TransformState,
  VFile,
} from './types';

export interface BoneLocalTransform {
  rotation: [number, number, number, number];
  position: [number, number, number];
}

export interface StudioEvents {
  stats: Stats;
  playback: PlaybackState;
  modelAdded: ModelInfo;
  modelRemoved: string;
  motionChanged: { modelId: string; motion: MotionInfo | null };
  cameraMotionChanged: CameraMotionInfo | null;
  audioChanged: AudioInfo | null;
  progress: { id: string; label: string; progress: number; done: boolean };
  warning: string;
  error: string;
  physicsStatus: { available: boolean; message?: string };
  boneSelected: { modelId: string; bone: number } | null;
  /** The scale gizmo changed a model transform (for undo/redo). */
  modelTransformEdited: { modelId: string; before: TransformState; after: TransformState };
  /** Fired at the end of a gizmo drag, for undo/redo. */
  boneEdited: { modelId: string; bone: number; before: BoneLocalTransform; after: BoneLocalTransform };
  cameraChanged: CameraState;
  /** The WebGL context was lost (mobile memory pressure, GPU reset). */
  contextLost: undefined;
  /** The context came back; GPU resources were rebuilt. */
  contextRestored: undefined;
  /** Morph weights changed outside of the UI (e.g. playground scripts). */
  morphsChanged: { modelId: string };
}

/** 'scale' applies to the whole active model (uniform). */
export type GizmoMode = 'rotate' | 'translate' | 'scale';

export interface LoadModelOptions {
  id?: string;
  name?: string;
  state?: Partial<ModelRuntimeState>;
}

export interface RecordProgress {
  phase: 'recording' | 'encoding' | 'done';
  progress: number;
  frame: number;
}

export interface StudioEngine {
  readonly events: Emitter<StudioEvents>;
  readonly physicsAvailable: boolean;
  readonly webgpu: boolean;

  dispose(): void;

  // settings
  applySettings(settings: SceneSettings): void;
  setHdrEnvironment(file: VFile | null): Promise<void>;

  // models
  loadModel(files: VFile[], mainPath: string, options?: LoadModelOptions): Promise<ModelInfo>;
  removeModel(id: string): void;
  listModels(): string[];
  setModelVisible(id: string, visible: boolean): void;
  setModelPhysics(id: string, enabled: boolean): void;
  /** Mark a model as stage scenery (see ModelRuntimeState.stage). */
  setModelStage(id: string, stage: boolean): void;
  setModelTransform(id: string, transform: TransformState): void;
  setMaterialState(
    id: string,
    index: number,
    state: { visible?: boolean; outline?: boolean; alpha?: number },
  ): void;
  setMorph(id: string, name: string, weight: number): void;
  getMorphWeights(id: string): Record<string, number>;
  resetMorphs(id: string): void;
  getModelState(id: string): ModelRuntimeState | null;
  /** Current world positions of a model's bones (by name), as rendered. */
  getBoneWorldPositions(id: string): Record<string, [number, number, number]> | null;
  /** Rest skeleton (model-space bone positions and hierarchy), for motion retargeting. */
  getSkeleton(
    id: string,
  ): { name: string; bones: { name: string; parent: number; position: [number, number, number] }[] } | null;

  // motion / media
  loadMotion(modelId: string, file: VFile | null): Promise<MotionInfo | null>;
  loadCameraMotion(file: VFile | null): Promise<CameraMotionInfo | null>;
  /** Replace a model's animation with an edited clip (live, no reload). */
  setMotionClip(modelId: string, clip: MotionClip | null, name?: string): MotionInfo | null;
  /** Replace the camera animation with an edited clip's camera track. */
  setCameraClip(clip: MotionClip | null, name?: string): CameraMotionInfo | null;
  /** Current local key values (VMD position offset + rotation), including unkeyed manual edits. */
  getBoneKeyValues(
    modelId: string,
    names?: string[],
  ): Record<string, { p: [number, number, number]; r: [number, number, number, number] }>;
  /** Rendered local rotations (after IK / append transforms). */
  getSolvedLocalRotations(modelId: string, names: string[]): Record<string, [number, number, number, number]>;
  /** Rendered model-space bone positions. */
  getBoneModelPositions(modelId: string, names: string[]): Record<string, [number, number, number]>;
  /** Evaluate frames (animation + IK, no physics) and read solved rotations / positions. */
  sampleModel(
    modelId: string,
    frames: number[],
    names: string[],
    opts?: { ik?: boolean },
  ): { r: Record<string, [number, number, number, number]>; pos: Record<string, [number, number, number]> }[];
  getIkChains(modelId: string): { bone: string; target: string; links: string[] }[];
  setIkEnabled(modelId: string, enabled: boolean): void;
  /** VMD keys that place each IK bone on its chain target in the FK pose (per frame). */
  fitIkTargets(
    modelId: string,
    frames: number[],
    ikBones: string[],
  ): Record<string, { f: number; p: [number, number, number]; r: [number, number, number, number] }[]>;
  /** Editor overlay lines (world space, drawn on top). Null removes the overlay. */
  setOverlayLines(
    id: string,
    segments:
      { a: [number, number, number]; b: [number, number, number]; color: [number, number, number] }[] | null,
  ): void;
  loadAudio(file: VFile | null): Promise<AudioInfo | null>;
  setAudioOffset(ms: number): void;
  setVolume(volume: number): void;

  // playback
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(frame: number): void;
  stepFrames(delta: number): void;
  setSpeed(speed: number): void;
  setLoop(loop: boolean): void;
  getPlayback(): PlaybackState;

  // camera
  setCameraMode(mode: CameraMode): void;
  setFov(fovDeg: number): void;
  applyCameraPreset(preset: CameraPreset, modelId?: string): void;
  setFollow(follow: { modelId: string; bone: string } | null): void;
  focusModel(id?: string): void;
  getCameraState(): CameraState;
  setCameraState(state: CameraState): void;
  focusDofOnHead(modelId?: string): number | null;

  // posing
  selectBone(modelId: string | null, bone: number | null): void;
  setGizmoMode(mode: GizmoMode): void;
  /** Model the scale gizmo / bone tap-picking operate on. */
  setActiveModel(id: string | null): void;
  /** Tap picking in canvas CSS pixels: nearest bone of the active model, else the tapped model. */
  pickAt(x: number, y: number, radius?: number): { modelId: string; bone: number | null } | null;
  getBoneTransform(modelId: string, bone: number): BoneLocalTransform | null;
  setBoneTransform(modelId: string, bone: number, t: BoneLocalTransform): void;
  getPose(modelId: string): PoseData | null;
  applyPose(modelId: string, pose: PoseData): void;
  resetPose(modelId: string): void;
  resetPhysics(): void;

  /** Unlock the audio context from a user gesture (required by iOS Safari). */
  unlockAudio(): void;
  /** Skip rendering while the viewport is hidden (playback keeps rendering). */
  setRenderPaused(paused: boolean): void;
  /** Current measured frames per second. */
  getFps(): number;

  /** Run a callback before every rendered frame (delta in ms). Returns an unsubscribe fn. */
  onBeforeFrame(cb: (deltaMs: number) => void): () => void;

  // capture
  screenshot(options: ScreenshotOptions): Promise<Blob>;
  record(options: RecordOptions, onProgress: (p: RecordProgress) => void, signal: AbortSignal): Promise<Blob>;
}

export async function createStudioEngine(canvas: HTMLCanvasElement): Promise<StudioEngine> {
  const { BabylonStudioEngine } = await import('./impl/BabylonStudioEngine');
  return BabylonStudioEngine.create(canvas);
}

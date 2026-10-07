// Public, framework-agnostic engine contract. This module is tiny and does not import Babylon:
// the implementation is code-split and loaded on demand via `createStudioEngine`.
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

  // motion / media
  loadMotion(modelId: string, file: VFile | null): Promise<MotionInfo | null>;
  loadCameraMotion(file: VFile | null): Promise<CameraMotionInfo | null>;
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

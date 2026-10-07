/**
 * Pose estimation backends. MediaPipe Pose Landmarker is the default implementation; anything that can
 * produce the 33-landmark BlazePose topology (image + metric world landmarks) can plug in here — e.g. an
 * SMPL-based estimator (WHAM, 4DHumans) that projects its joints onto these landmarks.
 */
export interface PoseEstimate {
  /** 33 × [x, y, z, visibility] normalised image coordinates of the analysed frame. */
  image: Float32Array;
  /** 33 × [x, y, z, visibility] metric world coordinates (metres, hip-centred, y down, z away). */
  world: Float32Array;
  /** People detected in this frame (1 when unknown). */
  people: number;
}

export type FrameImage = ImageBitmap | OffscreenCanvas | HTMLCanvasElement | VideoFrame;

export interface EstimatorStatus {
  phase: 'loading-runtime' | 'loading-model' | 'ready';
  /** 'GPU' or 'CPU' once ready. */
  delegate?: string;
  message: string;
}

export interface PoseEstimator {
  readonly id: string;
  readonly label: string;
  init(onStatus?: (s: EstimatorStatus) => void): Promise<void>;
  /**
   * Estimate the pose in one frame. `timestampMs` must increase monotonically within a run;
   * `timeSec` is the source time (used by synthetic backends).
   */
  estimate(frame: FrameImage, timestampMs: number, timeSec: number): Promise<PoseEstimate | null>;
  dispose(): void;
}

export type EstimatorId = 'mediapipe' | 'synthetic';

export interface EstimatorOptions {
  /** Absolute URL of the folder holding MediaPipe's WASM files. */
  wasmBase: string;
  modelUrl: string;
  /** Try the GPU delegate first (falls back to CPU). */
  preferGpu: boolean;
}

export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task';

export async function createEstimator(id: EstimatorId, options: EstimatorOptions): Promise<PoseEstimator> {
  if (id === 'synthetic') {
    const { SyntheticEstimator } = await import('./syntheticEstimator');
    return new SyntheticEstimator();
  }
  const { MediaPipeEstimator } = await import('./mediapipeEstimator');
  return new MediaPipeEstimator(options);
}

/**
 * Face estimation backends, run on upscaled head crops. MediaPipe Face Landmarker is the default; any
 * backend that yields ARKit-style blendshapes, a head pose and a few mesh points can plug in here (for
 * example a GPU SMPL-X / FLAME fitter that also covers the body and hands).
 */
import type { CropWindow } from '@/lib/video2vmd/types';
import type { EstimatorStatus, FrameImage } from './estimator';

export interface FaceEstimate {
  score: number;
  /** BLENDSHAPES order (52). */
  blend: number[];
  /** Column-major 4×4 facial transformation matrix (camera space, y up, z toward the viewer). */
  matrix: number[];
  /** FACE_POINT_KEYS × [x, y], normalised to the crop. */
  points: number[];
}

export interface FaceContext {
  /** Where the crop was taken (normalised analysed area). */
  window: CropWindow;
}

export interface FaceEstimator {
  readonly id: string;
  readonly label: string;
  init(onStatus?: (s: EstimatorStatus) => void): Promise<void>;
  estimate(
    crop: FrameImage,
    timestampMs: number,
    timeSec: number,
    ctx: FaceContext,
  ): Promise<FaceEstimate | null>;
  dispose(): void;
}

export const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

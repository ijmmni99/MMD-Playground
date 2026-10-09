/**
 * Hand estimation backends, run on upscaled wrist crops. MediaPipe Hand Landmarker is the default; any
 * backend producing the 21-point hand topology (image + metric hand-world points) can plug in here.
 */
import type { CropWindow } from '@/lib/video2vmd/types';
import type { EstimatorStatus, FrameImage } from './estimator';

export interface HandEstimate {
  score: number;
  handedness: string;
  handednessScore: number;
  /** 21 × [x, y, z], x / y normalised to the crop. */
  image: number[];
  /** 21 × [x, y, z] metres (hand-centred, camera axes, y down). */
  world: number[];
}

export interface HandContext {
  window: CropWindow;
  /** Which body wrist the crop follows: 0 = pose landmark 15, 1 = landmark 16. */
  wrist: 0 | 1;
}

export interface HandEstimator {
  readonly id: string;
  readonly label: string;
  init(onStatus?: (s: EstimatorStatus) => void): Promise<void>;
  /** All hands found in the crop (the caller keeps the one at the body's wrist). */
  estimate(crop: FrameImage, timestampMs: number, timeSec: number, ctx: HandContext): Promise<HandEstimate[]>;
  dispose(): void;
}

export const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

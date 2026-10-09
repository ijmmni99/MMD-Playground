import { PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { visionFileset } from './mediapipeFileset';
import type { EstimatorOptions, EstimatorStatus, FrameImage, PoseEstimate, PoseEstimator } from './estimator';
import { LANDMARK_COUNT } from './landmarks';

/** MediaPipe Pose Landmarker (heavy model), GPU delegate with CPU fallback. Works in module workers. */
export class MediaPipeEstimator implements PoseEstimator {
  readonly id = 'mediapipe';
  readonly label = 'MediaPipe Pose Landmarker (heavy)';
  private landmarker: PoseLandmarker | null = null;
  delegate: 'GPU' | 'CPU' = 'CPU';

  constructor(private readonly options: EstimatorOptions) {}

  async init(onStatus?: (s: EstimatorStatus) => void): Promise<void> {
    onStatus?.({ phase: 'loading-runtime', message: 'Loading pose runtime…' });
    // The "module" WASM build loads through dynamic import, which also works inside module workers.
    const fileset = await visionFileset(this.options.wasmBase);
    onStatus?.({
      phase: 'loading-model',
      message: 'Loading pose model (~30 MB, cached after the first run)…',
    });
    const create = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.options.modelUrl, delegate },
        runningMode: 'VIDEO',
        numPoses: 2,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        ...(delegate === 'GPU' && typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined'
          ? { canvas: new OffscreenCanvas(1, 1) }
          : {}),
      });
    if (this.options.preferGpu) {
      try {
        this.landmarker = await create('GPU');
        this.delegate = 'GPU';
      } catch (e) {
        console.warn('MediaPipe GPU delegate unavailable, using CPU', e);
      }
    }
    if (!this.landmarker) {
      this.landmarker = await create('CPU');
      this.delegate = 'CPU';
    }
    onStatus?.({ phase: 'ready', delegate: this.delegate, message: `Pose model ready (${this.delegate})` });
  }

  async estimate(frame: FrameImage, timestampMs: number): Promise<PoseEstimate | null> {
    if (!this.landmarker) throw new Error('Estimator not initialised');
    const result: PoseLandmarkerResult = this.landmarker.detectForVideo(frame as TexImageSource, timestampMs);
    const people = result.landmarks.length;
    if (!people || !result.worldLandmarks.length) return null;
    // Several people: keep the largest (closest / main dancer).
    let best = 0;
    if (people > 1) {
      let bestArea = -1;
      result.landmarks.forEach((lms, i) => {
        const xs = lms.map((l) => l.x);
        const ys = lms.map((l) => l.y);
        const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        if (area > bestArea) {
          bestArea = area;
          best = i;
        }
      });
    }
    const image = new Float32Array(LANDMARK_COUNT * 4);
    const world = new Float32Array(LANDMARK_COUNT * 4);
    result.landmarks[best].forEach((l, i) => image.set([l.x, l.y, l.z, l.visibility ?? 1], i * 4));
    result.worldLandmarks[best].forEach((l, i) => world.set([l.x, l.y, l.z, l.visibility ?? 1], i * 4));
    return { image, world, people };
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

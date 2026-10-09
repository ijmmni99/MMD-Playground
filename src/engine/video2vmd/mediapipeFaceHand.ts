// MediaPipe Face Landmarker and Hand Landmarker on crops (GPU delegate with CPU fallback; module workers).
import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { BLENDSHAPES, FACE_MESH_INDICES } from '@/lib/video2vmd/types';
import type { EstimatorStatus, FrameImage } from './estimator';
import type { FaceEstimate, FaceEstimator } from './faceEstimator';
import type { HandEstimate, HandEstimator } from './handEstimator';

export interface CropEstimatorOptions {
  wasmBase: string;
  modelUrl: string;
  preferGpu: boolean;
}

const gpuCanvas = (): { canvas?: OffscreenCanvas } =>
  typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined'
    ? { canvas: new OffscreenCanvas(1, 1) }
    : {};

async function withFallback<T>(
  preferGpu: boolean,
  create: (delegate: 'GPU' | 'CPU') => Promise<T>,
): Promise<{ task: T; delegate: 'GPU' | 'CPU' }> {
  if (preferGpu) {
    try {
      return { task: await create('GPU'), delegate: 'GPU' };
    } catch (e) {
      console.warn('MediaPipe GPU delegate unavailable, using CPU', e);
    }
  }
  return { task: await create('CPU'), delegate: 'CPU' };
}

const BLEND_POS = new Map<string, number>(BLENDSHAPES.map((n, i) => [n, i]));

export class MediaPipeFaceEstimator implements FaceEstimator {
  readonly id = 'mediapipe-face';
  readonly label = 'MediaPipe Face Landmarker';
  private task: FaceLandmarker | null = null;

  constructor(private readonly o: CropEstimatorOptions) {}

  async init(onStatus?: (s: EstimatorStatus) => void): Promise<void> {
    onStatus?.({ phase: 'loading-model', message: 'Loading face model (~4 MB)…' });
    const fileset = await FilesetResolver.forVisionTasks(this.o.wasmBase, true);
    const { task, delegate } = await withFallback(this.o.preferGpu, (d) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.o.modelUrl, delegate: d },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.4,
        minFacePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
        ...(d === 'GPU' ? gpuCanvas() : {}),
      }),
    );
    this.task = task;
    onStatus?.({ phase: 'ready', delegate, message: `Face model ready (${delegate})` });
  }

  async estimate(crop: FrameImage, timestampMs: number): Promise<FaceEstimate | null> {
    if (!this.task) throw new Error('Face estimator not initialised');
    const r: FaceLandmarkerResult = this.task.detectForVideo(crop as TexImageSource, timestampMs);
    const lms = r.faceLandmarks[0];
    if (!lms?.length) return null;
    const blend = new Array<number>(BLENDSHAPES.length).fill(0);
    for (const c of r.faceBlendshapes[0]?.categories ?? []) {
      const i = BLEND_POS.get(c.categoryName);
      if (i !== undefined) blend[i] = c.score;
    }
    const points: number[] = [];
    for (const i of FACE_MESH_INDICES) {
      const p = lms[Math.min(i, lms.length - 1)];
      points.push(p.x, p.y);
    }
    const m = r.facialTransformationMatrixes[0]?.data;
    return {
      // Face Landmarker has no per-face score; presence is implied. Use the eye-open consistency proxy 1.
      score: 0.9,
      blend,
      matrix: m && m.length === 16 ? [...m] : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      points,
    };
  }

  dispose(): void {
    this.task?.close();
    this.task = null;
  }
}

/**
 * One Hand Landmarker per wrist crop: VIDEO mode tracks across frames, and alternating two different crops
 * through one instance would break its tracking.
 */
export class MediaPipeHandEstimator implements HandEstimator {
  readonly id = 'mediapipe-hand';
  readonly label = 'MediaPipe Hand Landmarker';
  private tasks: [HandLandmarker | null, HandLandmarker | null] = [null, null];

  constructor(private readonly o: CropEstimatorOptions) {}

  async init(onStatus?: (s: EstimatorStatus) => void): Promise<void> {
    onStatus?.({ phase: 'loading-model', message: 'Loading hand model (~8 MB)…' });
    const fileset = await FilesetResolver.forVisionTasks(this.o.wasmBase, true);
    let used: 'GPU' | 'CPU' = 'CPU';
    for (const k of [0, 1] as const) {
      const { task, delegate } = await withFallback(this.o.preferGpu, (d) =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: this.o.modelUrl, delegate: d },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.4,
          minHandPresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
          ...(d === 'GPU' ? gpuCanvas() : {}),
        }),
      );
      this.tasks[k] = task;
      used = delegate;
    }
    onStatus?.({ phase: 'ready', delegate: used, message: `Hand model ready (${used})` });
  }

  async estimate(
    crop: FrameImage,
    timestampMs: number,
    _t: number,
    ctx: { wrist: 0 | 1 },
  ): Promise<HandEstimate[]> {
    const task = this.tasks[ctx.wrist];
    if (!task) throw new Error('Hand estimator not initialised');
    const r: HandLandmarkerResult = task.detectForVideo(crop as TexImageSource, timestampMs);
    return r.landmarks.map((lms, i) => {
      const cat = r.handedness[i]?.[0];
      return {
        score: cat?.score ?? 0.5,
        handedness: cat?.categoryName ?? '',
        handednessScore: cat?.score ?? 0,
        image: lms.flatMap((p) => [p.x, p.y, p.z]),
        world: (r.worldLandmarks[i] ?? []).flatMap((p) => [p.x, p.y, p.z]),
      };
    });
  }

  dispose(): void {
    this.tasks.forEach((t) => t?.close());
    this.tasks = [null, null];
  }
}

import {
  CropTracker,
  FACE_INPUT,
  HAND_INPUT,
  cropToArea,
  headWindow,
  toNormalized,
  wristWindow,
} from '@/lib/video2vmd/crop';
import type { CropWindow, FaceObs, HandObs, HandPair } from '@/lib/video2vmd/types';
import {
  createEstimator,
  createFaceEstimator,
  createHandEstimator,
  type EstimatorId,
  type EstimatorStatus,
  type PoseEstimator,
} from './estimator';
import type { FaceEstimator } from './faceEstimator';
import type { AnalysedFrame, FrameSource } from './frameSource';
import type { HandEstimate, HandEstimator } from './handEstimator';
import type { SyntheticViewConfig } from './syntheticV2';
import type { CropBox, PoseFrame, PoseSequence, VideoInfo } from './types';

export interface DetectRequest {
  file: Blob;
  info: VideoInfo;
  trim: [number, number];
  crop: CropBox | null;
  /** Long edge of the analysed frames in pixels. */
  maxLongEdge: number;
  /** Sampling rate (≤ the video's fps). */
  sampleFps: number;
  estimator: EstimatorId;
  wasmBase: string;
  modelUrl: string;
  preferGpu: boolean;
  /** Synthetic backend only: artificial per-frame delay (tests). */
  estimatorDelayMs?: number;
  /** Resume: skip frames before this source time. */
  resumeFrom?: number;
  /** Crop pass: face and / or hand estimation on upscaled crops. */
  features?: { face: boolean; hands: boolean };
  faceModelUrl?: string;
  handModelUrl?: string;
  /** Synthetic two-camera backend: which view this run is. */
  synthetic?: SyntheticViewConfig;
}

export interface DetectProgress {
  done: number;
  total: number;
  /** Seconds remaining (estimate). */
  eta: number;
  /** Frames analysed per second. */
  rate: number;
  /** Latest frame (for the live skeleton overlay). */
  frame?: PoseFrame;
  /** Small preview of the latest analysed frame (every few hundred ms). */
  thumbnail?: ImageBitmap;
}

export interface DetectCallbacks {
  onStatus(s: EstimatorStatus & { backend: string }): void;
  onProgress(p: DetectProgress): void;
  onFrame(f: PoseFrame): void;
}

/**
 * Frame extraction + pose estimation. Runs anywhere (Worker or main thread); yields to the event loop
 * every frame so a main-thread run never freezes the UI. Returns the frames collected so far when
 * cancelled (resume continues from the last one).
 */
export async function detectPoses(
  req: DetectRequest,
  source: FrameSource,
  cb: DetectCallbacks,
  signal: AbortSignal,
  estimatorOverride?: PoseEstimator,
): Promise<{ sequence: PoseSequence; cancelled: boolean }> {
  const opts = {
    wasmBase: req.wasmBase,
    modelUrl: req.modelUrl,
    preferGpu: req.preferGpu,
    delayMs: req.estimatorDelayMs,
    synthetic: req.synthetic,
  };
  const estimator = estimatorOverride ?? (await createEstimator(req.estimator, opts));
  let backend = estimator.label;
  await estimator.init((s) => {
    if (s.delegate) backend = `${estimator.label} · ${s.delegate}`;
    cb.onStatus({ ...s, backend });
  });
  const face = req.features?.face
    ? await createFaceEstimator(req.estimator, { ...opts, faceModelUrl: req.faceModelUrl ?? '' })
    : null;
  const hands = req.features?.hands
    ? await createHandEstimator(req.estimator, { ...opts, handModelUrl: req.handModelUrl ?? '' })
    : null;
  for (const e of [face, hands]) {
    if (!e) continue;
    await e.init((s) =>
      cb.onStatus({ ...s, phase: s.phase === 'ready' ? 'loading-model' : s.phase, backend }),
    );
  }
  if (face || hands) cb.onStatus({ phase: 'ready', message: 'Models ready', backend });
  const crop = new CropPass(source.size, req.sampleFps, face, hands);

  const start = Math.max(req.trim[0], req.resumeFrom ?? req.trim[0]);
  const end = req.trim[1];
  const total = Math.max(1, Math.round((req.trim[1] - req.trim[0]) * req.sampleFps));
  const skipped = Math.round((start - req.trim[0]) * req.sampleFps);
  const frames: PoseFrame[] = [];
  const t0 = performance.now();
  let lastThumb = 0;
  let lastTs = -1;
  const yieldToLoop = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  try {
    for await (const f of source.frames({ start, end, fps: req.sampleFps }, signal)) {
      if (signal.aborted) break;
      // detectForVideo needs strictly increasing timestamps.
      const ts = Math.max(lastTs + 1, Math.round(f.time * 1000));
      lastTs = ts;
      const est = await estimator.estimate(f.canvas, ts, f.time);
      const extra = est && (face || hands) ? await crop.run(f, est.image, ts) : {};
      const frame: PoseFrame = est
        ? { time: f.time, detected: true, image: est.image, world: est.world, people: est.people, ...extra }
        : {
            time: f.time,
            detected: false,
            image: new Float32Array(0),
            world: new Float32Array(0),
            people: 0,
          };
      frames.push(frame);
      cb.onFrame(frame);
      const now = performance.now();
      const done = skipped + frames.length;
      const rate = frames.length / Math.max(0.001, (now - t0) / 1000);
      let thumbnail: ImageBitmap | undefined;
      if (now - lastThumb > 250 && typeof createImageBitmap === 'function') {
        lastThumb = now;
        const scale = Math.min(1, 480 / Math.max(f.canvas.width, f.canvas.height));
        thumbnail = await createImageBitmap(f.canvas, {
          resizeWidth: Math.max(1, Math.round(f.canvas.width * scale)),
          resizeHeight: Math.max(1, Math.round(f.canvas.height * scale)),
        });
      }
      cb.onProgress({ done, total, rate, eta: Math.max(0, (total - done) / rate), frame, thumbnail });
      await yieldToLoop();
    }
  } finally {
    estimator.dispose();
    face?.dispose();
    hands?.dispose();
    source.dispose();
  }
  return {
    cancelled: signal.aborted,
    sequence: {
      version: 1,
      estimator: backend,
      video: req.info,
      trim: req.trim,
      crop: req.crop,
      analysedSize: source.size,
      sampleFps: req.sampleFps,
      frames,
    },
  };
}

/** Face / hand estimation on tracked crops of each frame. */
class CropPass {
  private head = new CropTracker();
  private wrists = [new CropTracker(), new CropTracker()];

  constructor(
    private readonly size: [number, number],
    private readonly fps: number,
    private readonly face: FaceEstimator | null,
    private readonly hands: HandEstimator | null,
  ) {}

  async run(
    f: AnalysedFrame,
    pose: ArrayLike<number>,
    ts: number,
  ): Promise<{ face?: FaceObs | null; hands?: HandPair }> {
    const dt = 1 / this.fps;
    const out: { face?: FaceObs | null; hands?: HandPair } = {};
    if (this.face) {
      const w = this.head.update(headWindow(pose, this.size), dt);
      out.face = null;
      if (w) {
        const win = toNormalized(w, this.size);
        const est = await this.face.estimate(f.crop(win, FACE_INPUT, 'face'), ts, f.time, { window: win });
        if (est) {
          const points: number[] = [];
          for (let i = 0; i < est.points.length; i += 2)
            points.push(...cropToArea(win, est.points[i], est.points[i + 1]));
          out.face = { score: est.score, blend: est.blend, matrix: est.matrix, points, crop: win };
        }
      }
    }
    if (this.hands) {
      const pair: HandPair = [null, null];
      for (const k of [0, 1] as const) {
        const w = this.wrists[k].update(wristWindow(pose, k, this.size), dt);
        if (!w) continue;
        const win = toNormalized(w, this.size);
        const found = await this.hands.estimate(f.crop(win, HAND_INPUT, `hand${k}`), ts, f.time, {
          window: win,
          wrist: k,
        });
        const wrist: [number, number] = [pose[(15 + k) * 4], pose[(15 + k) * 4 + 1]];
        pair[k] = pickHand(found, win, wrist);
      }
      out.hands = pair;
    }
    return out;
  }
}

/**
 * Keep the hand whose wrist is nearest the body's wrist (the crop can contain both hands); its side comes
 * from the body, not from the handedness label.
 */
export function pickHand(
  found: HandEstimate[],
  win: CropWindow,
  bodyWrist: [number, number],
): HandObs | null {
  let best: HandObs | null = null;
  let bestD = Infinity;
  for (const h of found) {
    if (h.image.length < 63) continue;
    const image: number[] = [];
    for (let i = 0; i < h.image.length; i += 3)
      image.push(...cropToArea(win, h.image[i], h.image[i + 1]), h.image[i + 2]);
    const d = Math.hypot((image[0] - bodyWrist[0]) / win.w, (image[1] - bodyWrist[1]) / win.h);
    if (d < bestD) {
      bestD = d;
      best = {
        score: h.score,
        handedness: h.handedness,
        handednessScore: h.handednessScore,
        image,
        world: h.world,
        crop: win,
      };
    }
  }
  // A hand far from the body's wrist belongs to someone / something else.
  return bestD < 0.6 ? best : null;
}

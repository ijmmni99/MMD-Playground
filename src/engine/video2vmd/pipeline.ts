import { createEstimator, type EstimatorId, type EstimatorStatus, type PoseEstimator } from './estimator';
import type { FrameSource } from './frameSource';
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
  const estimator =
    estimatorOverride ??
    (await createEstimator(req.estimator, {
      wasmBase: req.wasmBase,
      modelUrl: req.modelUrl,
      preferGpu: req.preferGpu,
      delayMs: req.estimatorDelayMs,
    }));
  let backend = estimator.label;
  await estimator.init((s) => {
    if (s.delegate) backend = `${estimator.label} · ${s.delegate}`;
    cb.onStatus({ ...s, backend });
  });

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
      const frame: PoseFrame = est
        ? { time: f.time, detected: true, image: est.image, world: est.world, people: est.people }
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

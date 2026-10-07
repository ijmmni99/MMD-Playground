import { createSeekSource, createWebCodecsSource } from './frameSource';
import { detectPoses, type DetectProgress, type DetectRequest } from './pipeline';
import type { WorkerIn, WorkerOut } from './pipeline.worker';
import type { PoseSequence } from './types';

export interface DetectionCallbacks {
  onStatus(message: string, backend: string): void;
  onProgress(p: DetectProgress): void;
}

export interface DetectionResult {
  sequence: PoseSequence;
  cancelled: boolean;
  /** Where the work ran. */
  mode: 'worker' | 'main-webcodecs' | 'main-seek';
}

/** Run detection in a Worker (WebCodecs + OffscreenCanvas); fall back to the main thread if needed. */
export async function runDetection(
  req: DetectRequest,
  cb: DetectionCallbacks,
  signal: AbortSignal,
  opts: { allowWorker?: boolean } = {},
): Promise<DetectionResult> {
  if (opts.allowWorker !== false && typeof Worker !== 'undefined') {
    const viaWorker = await tryWorker(req, cb, signal);
    if (viaWorker) return { ...viaWorker, mode: 'worker' };
  }
  // Main thread: WebCodecs when available, else <video> seeking.
  let source;
  let mode: DetectionResult['mode'] = 'main-webcodecs';
  try {
    if (typeof VideoDecoder === 'undefined') throw new Error('no WebCodecs');
    source = await createWebCodecsSource(req.file, req.crop, req.maxLongEdge);
  } catch {
    source = await createSeekSource(req.file, req.info, req.crop, req.maxLongEdge);
    mode = 'main-seek';
  }
  const result = await detectPoses(
    req,
    source,
    {
      onStatus: (s) => cb.onStatus(s.message, s.backend),
      onProgress: (p) => cb.onProgress(p),
      onFrame: () => undefined,
    },
    signal,
  );
  return { ...result, mode };
}

function tryWorker(
  req: DetectRequest,
  cb: DetectionCallbacks,
  signal: AbortSignal,
): Promise<{ sequence: PoseSequence; cancelled: boolean } | null> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    const onAbort = (): void => worker.postMessage({ type: 'cancel' } satisfies WorkerIn);
    signal.addEventListener('abort', onAbort);
    const finish = (): void => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    worker.onerror = (e) => {
      console.warn('Pose worker failed, falling back to the main thread', e.message);
      finish();
      resolve(null);
    };
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      switch (m.type) {
        case 'unsupported':
          console.info('Pose worker unsupported:', m.reason);
          finish();
          resolve(null);
          break;
        case 'status':
          cb.onStatus(m.message, m.backend);
          break;
        case 'progress':
          cb.onProgress(m);
          break;
        case 'done':
          finish();
          resolve({ sequence: m.sequence, cancelled: m.cancelled });
          break;
        case 'error':
          finish();
          reject(new Error(m.message));
          break;
      }
    };
    worker.postMessage({ type: 'start', request: req } satisfies WorkerIn);
  });
}

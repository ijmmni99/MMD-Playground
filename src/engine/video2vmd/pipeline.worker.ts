/// <reference lib="webworker" />
// Frame extraction + pose estimation off the main thread.
import { createWebCodecsSource } from './frameSource';
import { detectPoses, type DetectRequest } from './pipeline';
import type { PoseFrame } from './types';

export type WorkerIn = { type: 'start'; request: DetectRequest } | { type: 'cancel' };
export type WorkerOut =
  | { type: 'unsupported'; reason: string }
  | { type: 'status'; message: string; backend: string; phase: string }
  | {
      type: 'progress';
      done: number;
      total: number;
      eta: number;
      rate: number;
      frame?: PoseFrame;
      thumbnail?: ImageBitmap;
    }
  | { type: 'done'; sequence: import('./types').PoseSequence; cancelled: boolean }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let controller: AbortController | null = null;

const post = (msg: WorkerOut, transfer: Transferable[] = []): void => ctx.postMessage(msg, transfer);

ctx.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    controller?.abort();
    return;
  }
  if (typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    post({ type: 'unsupported', reason: 'WebCodecs / OffscreenCanvas not available in workers' });
    return;
  }
  controller = new AbortController();
  try {
    const source = await createWebCodecsSource(msg.request.file, msg.request.crop, msg.request.maxLongEdge);
    const result = await detectPoses(
      msg.request,
      source,
      {
        onStatus: (s) => post({ type: 'status', message: s.message, backend: s.backend, phase: s.phase }),
        onProgress: (p) => post({ type: 'progress', ...p }, p.thumbnail ? [p.thumbnail] : []),
        onFrame: () => undefined,
      },
      controller.signal,
    );
    post({ type: 'done', ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Codec problems: let the main thread try its <video> fallback.
    if (/cannot decode|canDecode|not supported|NotSupportedError/i.test(message)) {
      post({ type: 'unsupported', reason: message });
    } else {
      post({ type: 'error', message });
    }
  }
};

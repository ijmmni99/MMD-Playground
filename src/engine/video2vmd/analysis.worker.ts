/// <reference lib="webworker" />
// Audio analysis off the main thread: lip-sync vowels and two-view audio sync.
import { lipSyncVowels } from '@/lib/video2vmd/lipsync';
import { audioSync, type SyncResult } from '@/lib/video2vmd/sync';
import type { Vowel } from '@/lib/video2vmd/face';

export type AnalysisIn =
  | { id: number; type: 'lipsync'; samples: Float32Array; sampleRate: number; fps: number }
  | {
      id: number;
      type: 'sync';
      front: { samples: Float32Array; sampleRate: number };
      side: { samples: Float32Array; sampleRate: number };
      maxOffset: number;
    };
export type AnalysisOut =
  | { id: number; type: 'lipsync'; vowels: Record<Vowel, number[]> }
  | { id: number; type: 'sync'; result: SyncResult }
  | { id: number; type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = (e: MessageEvent<AnalysisIn>) => {
  const m = e.data;
  try {
    if (m.type === 'lipsync') {
      const n = Math.ceil((m.samples.length / m.sampleRate) * m.fps);
      const times = Array.from({ length: n }, (_, k) => k / m.fps);
      ctx.postMessage({
        id: m.id,
        type: 'lipsync',
        vowels: lipSyncVowels(m.samples, m.sampleRate, times, m.fps),
      } satisfies AnalysisOut);
    } else {
      ctx.postMessage({
        id: m.id,
        type: 'sync',
        result: audioSync(m.front, m.side, m.maxOffset),
      } satisfies AnalysisOut);
    }
  } catch (err) {
    ctx.postMessage({
      id: m.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies AnalysisOut);
  }
};

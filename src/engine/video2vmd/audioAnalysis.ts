// Main-thread side of audio analysis: decode a video's soundtrack to mono PCM (OfflineAudioContext,
// downsampled), then run lip-sync / sync in a Worker (main-thread fallback).
import type { Vowel } from '@/lib/video2vmd/face';
import { lipSyncVowels } from '@/lib/video2vmd/lipsync';
import { audioSync, type SyncResult } from '@/lib/video2vmd/sync';
import type { AnalysisIn, AnalysisOut } from './analysis.worker';

export const ANALYSIS_RATE = 11025;

export interface MonoAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** Decode a media file's audio to mono at `rate` Hz. Null when it has no decodable audio. */
export async function decodeMono(blob: Blob, rate = ANALYSIS_RATE): Promise<MonoAudio | null> {
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC || typeof OfflineAudioContext === 'undefined') return null;
  const ac = new AC();
  try {
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * rate));
    const off = new OfflineAudioContext(1, length, rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return { samples: out.getChannelData(0).slice(), sampleRate: rate };
  } catch {
    return null;
  } finally {
    void ac.close();
  }
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (m: AnalysisOut) => void>();

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function call(
  msg: DistributiveOmit<AnalysisIn, 'id'>,
  transfer: Transferable[],
): Promise<AnalysisOut> | null {
  try {
    worker ??= new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AnalysisOut>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
  } catch {
    return null;
  }
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ ...msg, id } as AnalysisIn, transfer);
  });
}

/** Lip-sync vowels every 1/fps seconds of the audio. */
export async function lipSyncFromAudio(audio: MonoAudio, fps = 30): Promise<Record<Vowel, number[]>> {
  const copy = audio.samples.slice();
  const r = call({ type: 'lipsync', samples: copy, sampleRate: audio.sampleRate, fps }, [copy.buffer]);
  const out = r ? await r : null;
  if (out?.type === 'lipsync') return out.vowels;
  const n = Math.ceil((audio.samples.length / audio.sampleRate) * fps);
  return lipSyncVowels(
    audio.samples,
    audio.sampleRate,
    Array.from({ length: n }, (_, k) => k / fps),
    fps,
  );
}

/** Audio sync of two tracks (side time = front time + offset). */
export async function syncFromAudio(front: MonoAudio, side: MonoAudio, maxOffset = 10): Promise<SyncResult> {
  const f = front.samples.slice();
  const s = side.samples.slice();
  const r = call(
    {
      type: 'sync',
      front: { samples: f, sampleRate: front.sampleRate },
      side: { samples: s, sampleRate: side.sampleRate },
      maxOffset,
    },
    [f.buffer, s.buffer],
  );
  const out = r ? await r : null;
  if (out?.type === 'sync') return out.result;
  return audioSync(front, side, maxOffset);
}

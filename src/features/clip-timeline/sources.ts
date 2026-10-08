// Runtime cache of parsed sources (motions as MotionClips, audio as waveform peaks). The timeline
// document only stores source metadata and file refs.

import type { VFile } from '@/engine/types';
import { getAsset, registerFile, resolveRef } from '@/lib/assets';
import type { Source } from '@/lib/clips/types';
import { clipEndFrame } from '@/lib/motion/evaluate';
import { autoBlink, lipPattern } from '@/lib/motion/tools';
import { emptyClip, type MotionClip } from '@/lib/motion/types';
import { readVmd, writeVmd } from '@/lib/motion/vmd';
import { ct } from '@/store/clipTimeline';

const clips = new Map<string, MotionClip>();
const peaks = new Map<string, Float32Array>();
const loading = new Map<string, Promise<void>>();

export const getSourceClip = (id: string): MotionClip | undefined => clips.get(id);
export const getPeaks = (id: string): Float32Array | undefined => peaks.get(id);

const bump = (): void => ct.set((s) => ({ sourcesRevision: s.sourcesRevision + 1 }));

let seq = 0;
export const sourceId = (): string => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Kind of a parsed VMD: camera-only, face-only (morphs, no bones) or a body motion. */
export function vmdKind(clip: MotionClip): Source['kind'] {
  if (clip.camera.length && !clip.bones.length) return 'camera';
  if (!clip.bones.length && clip.morphs.length) return 'face';
  return 'motion';
}

/** Register a VMD file as a source. */
export async function addVmdSource(file: VFile): Promise<Source> {
  const ref = await registerFile(file);
  const clip = readVmd(await file.blob.arrayBuffer());
  const src: Source = {
    id: sourceId(),
    kind: vmdKind(clip),
    name: file.path.split('/').pop() ?? 'motion.vmd',
    ref,
    length: Math.max(1, clipEndFrame(clip)),
  };
  clips.set(src.id, clip);
  bump();
  return src;
}

/** Register an in-memory clip (generated face preset, edited copy) as a stored source. */
export async function addClipSource(
  clip: MotionClip,
  name: string,
  kind: Source['kind'],
  id = sourceId(),
): Promise<Source> {
  const ref = await registerFile({
    path: name,
    blob: new Blob([writeVmd(clip)], { type: 'application/octet-stream' }),
  });
  clips.set(id, clip);
  bump();
  return { id, kind, name, ref, length: Math.max(1, clipEndFrame(clip)) };
}

/** Replace a source's motion (keyframe editor round trip); returns the new file ref. */
export async function replaceSourceClip(src: Source, clip: MotionClip): Promise<Source> {
  return addClipSource(clip, src.name, src.kind, src.id);
}

/** Register an audio file as a source (waveform computed in the background). */
export async function addAudioSource(file: VFile, durationSeconds: number): Promise<Source> {
  const ref = await registerFile(file);
  const src: Source = {
    id: sourceId(),
    kind: 'audio',
    name: file.path.split('/').pop() ?? 'audio',
    ref,
    length: Math.max(1, Math.round(durationSeconds * 30)),
  };
  void computePeaks(src.id, file.blob);
  return src;
}

async function computePeaks(id: string, blob: Blob): Promise<void> {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const data = buf.getChannelData(0);
    // One peak per frame (30 fps).
    const n = Math.max(1, Math.ceil(buf.duration * 30));
    const out = new Float32Array(n);
    const per = data.length / n;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const a = Math.floor(i * per);
      const b = Math.min(data.length, Math.floor((i + 1) * per));
      for (let j = a; j < b; j += 4) m = Math.max(m, Math.abs(data[j]));
      out[i] = m;
    }
    peaks.set(id, out);
    bump();
  } catch {
    /* no waveform */
  }
}

/** Load stored sources (project restore). Missing files are reported, not thrown. */
export async function loadSources(sources: readonly Source[]): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(
    sources.map(async (s) => {
      if (!s.ref || clips.has(s.id) || peaks.has(s.id)) return;
      let p = loading.get(s.id);
      if (!p) {
        p = (async () => {
          try {
            if (s.kind === 'audio') {
              const blob = await getAsset(s.ref!.blobId);
              if (blob) await computePeaks(s.id, blob);
              else missing.push(s.name);
              return;
            }
            const f = await resolveRef(s.ref!);
            clips.set(s.id, readVmd(await f.blob.arrayBuffer()));
          } catch {
            missing.push(s.name);
          }
        })();
        loading.set(s.id, p);
      }
      await p;
      loading.delete(s.id);
    }),
  );
  bump();
  return missing;
}

export type FacePreset = 'blink' | 'smile' | 'talk' | 'surprised';

export const FACE_PRESETS: { id: FacePreset; label: string; frames: number }[] = [
  { id: 'blink', label: 'Natural blinking', frames: 300 },
  { id: 'talk', label: 'Talking mouth', frames: 120 },
  { id: 'smile', label: 'Smile', frames: 60 },
  { id: 'surprised', label: 'Surprised', frames: 45 },
];

/** Generated face motion (standard MMD morph names). */
export function facePresetClip(p: FacePreset): MotionClip {
  const len = FACE_PRESETS.find((x) => x.id === p)!.frames;
  const base = emptyClip('face');
  const hold = (morphs: Record<string, number>): MotionClip => ({
    ...base,
    morphs: Object.entries(morphs).map(([name, w]) => ({
      name,
      keys: [
        { f: 0, w: 0 },
        { f: 6, w },
        { f: len - 6, w },
        { f: len, w: 0 },
      ],
    })),
  });
  switch (p) {
    case 'blink':
      return autoBlink(base, 0, len, { interval: 80, seed: 11 });
    case 'talk':
      return lipPattern(base, 0, len, 8, 5);
    case 'smile':
      return hold({ 笑い: 1, にっこり: 0.8 });
    case 'surprised':
      return hold({ びっくり: 1, あ: 0.6, 上: 0.7 });
  }
}

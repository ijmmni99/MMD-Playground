// Applies the timeline to the engine: debounced, per-track incremental bakes into the models' and the
// camera's runtime animation, the audio clip under the playhead, and the playback length.

import { applyFace, bakeCamera, bakeDance } from '@/lib/clips/bake';
import { trackClips, timelineEnd } from '@/lib/clips/ops';
import { clipEnd, type Clip, type TimelineDoc } from '@/lib/clips/types';
import type { MotionClip } from '@/lib/motion/types';
import { ct, useClipTimeline } from '@/store/clipTimeline';
import { engineOrNull } from '@/store/engineRef';
import { motionHooks } from '@/store/motionEditor';
import { studio, updateModel } from '@/store/studio';
import { getSourceClip } from './sources';

const BAKE_MS = 60;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Per-target signature of what was last baked (skip unchanged tracks). */
const lastSig = new Map<string, string>();
/** Last baked clips (VMD export, Advanced view). */
export const baked: { models: Map<string, MotionClip>; camera: MotionClip | null } = { models: new Map(), camera: null };

const sig = (clips: Clip[], rev: number): string => JSON.stringify(clips) + '|' + rev;

export function scheduleBake(now = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (now) bakeNow();
  else timer = setTimeout(bakeNow, BAKE_MS);
}

export function bakeNow(): void {
  timer = null;
  const engine = engineOrNull();
  if (!engine) return;
  const { doc, sourcesRevision, editing } = ct.get();
  const get = (id: string) => getSourceClip(id);
  const models = studio.get().models;

  for (const track of doc.tracks) {
    if (track.kind !== 'dance' || !track.modelId) continue;
    const modelId = track.modelId;
    // The keyframe editor owns the model while a clip is open there.
    if (editing?.modelId === modelId) continue;
    if (!models.some((m) => m.id === modelId)) continue;
    const dance = trackClips(doc, track.id);
    const faceTrack = doc.tracks.find((t) => t.kind === 'face' && t.modelId === modelId);
    const face = faceTrack ? trackClips(doc, faceTrack.id) : [];
    const s = sig([...dance, ...face], sourcesRevision);
    if (lastSig.get(modelId) === s) continue;
    lastSig.set(modelId, s);
    if (!dance.length && !face.length) {
      baked.models.delete(modelId);
      continue;
    }
    let clip = bakeDance(dance, get);
    if (face.length) {
      const faceClip = bakeDance(face, get, 'face');
      clip = applyFace(clip, faceClip, face.map((c) => [c.startFrame, clipEnd(c)] as [number, number]));
    }
    baked.models.set(modelId, clip);
    const info = engine.setMotionClip(modelId, clip, 'Clip timeline');
    updateModel(modelId, { motion: info });
    motionHooks.motionReplaced?.(modelId);
  }

  const camTrack = doc.tracks.find((t) => t.kind === 'camera');
  if (camTrack && editing?.modelId !== '__camera__') {
    const cams = trackClips(doc, camTrack.id);
    const s = sig(cams, sourcesRevision);
    if (lastSig.get('__camera__') !== s) {
      lastSig.set('__camera__', s);
      if (cams.length) {
        const cam = bakeCamera(cams, get);
        baked.camera = cam;
        engine.setCameraClip(cam, 'Clip timeline camera');
      } else baked.camera = null;
    }
  }
  engine.setMinDuration(timelineEnd(doc));
}

/** Forget what was baked (project switch). */
export function resetBakeState(): void {
  lastSig.clear();
  baked.models.clear();
  baked.camera = null;
}

// ---------------------------------------------------------------- audio

let audioOff: (() => void) | null = null;
let lastAudio = { offsetMs: NaN, volume: NaN };

/** While the audio track has clips, the clip under the playhead sets the audio offset and volume. */
function syncAudio(doc: TimelineDoc): void {
  const engine = engineOrNull();
  const track = doc.tracks.find((t) => t.kind === 'audio');
  const clips = track ? trackClips(doc, track.id) : [];
  if (!engine || !clips.length) {
    audioOff?.();
    audioOff = null;
    return;
  }
  if (audioOff) return;
  audioOff = engine.onBeforeFrame(() => {
    const d = ct.get().doc;
    const t = d.tracks.find((x) => x.kind === 'audio');
    if (!t) return;
    const frame = engine.getPlayback().frame;
    const list = trackClips(d, t.id);
    const active = list.find((c) => frame >= c.startFrame && frame < clipEnd(c));
    const base = studio.get().volume;
    const offsetMs = active ? ((active.startFrame - active.sourceIn) / 30) * 1000 : lastAudio.offsetMs;
    const volume = active ? base * (active.volume ?? 1) : 0;
    if (Number.isFinite(offsetMs) && Math.abs(offsetMs - lastAudio.offsetMs) > 0.5) engine.setAudioOffset(offsetMs);
    if (Math.abs(volume - lastAudio.volume) > 1e-3) engine.setVolume(volume);
    lastAudio = { offsetMs, volume };
  });
}

// ---------------------------------------------------------------- text (loaded once a text clip exists)

let textLoaded = false;
function ensureText(doc: TimelineDoc): void {
  if (textLoaded || !doc.clips.some((c) => c.text)) return;
  textLoaded = true;
  void import('./textRuntime').then((m) => m.syncText());
}

// React to document changes.
useClipTimeline.subscribe((s, prev) => {
  if (s.doc !== prev.doc || s.sourcesRevision !== prev.sourcesRevision || s.editing !== prev.editing) {
    scheduleBake();
    syncAudio(s.doc);
  }
  if (s.doc !== prev.doc) ensureText(s.doc);
});

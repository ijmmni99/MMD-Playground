// Pure timeline edit operations. Each returns a new document (unchanged clips keep their identity).

import {
  clipEnd,
  clipLength,
  DEFAULT_JOIN,
  passLength,
  SPEED_RANGE,
  type Clip,
  type Source,
  type TextSpec,
  type TimelineDoc,
  type Track,
  type TrackKind,
} from './types';
import { LOOP_SEAM } from './bake';

let seq = 0;
export const clipId = (prefix = 'c'): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

const mapClip = (doc: TimelineDoc, id: string, fn: (c: Clip) => Clip): TimelineDoc => ({
  ...doc,
  clips: doc.clips.map((c) => (c.id === id ? fn(c) : c)),
});

export const findClip = (doc: TimelineDoc, id: string): Clip | undefined =>
  doc.clips.find((c) => c.id === id);
export const trackClips = (doc: TimelineDoc, trackId: string): Clip[] =>
  doc.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startFrame - b.startFrame);

/** The track of a kind (for a model), created when missing. */
export function ensureTrack(
  doc: TimelineDoc,
  kind: TrackKind,
  modelId?: string,
  name?: string,
): { doc: TimelineDoc; track: Track } {
  const t = doc.tracks.find(
    (x) => x.kind === kind && (kind === 'dance' || kind === 'face' ? x.modelId === modelId : true),
  );
  if (t) return { doc, track: t };
  const track: Track = {
    id: clipId('t'),
    kind,
    ...(modelId ? { modelId } : {}),
    name: name ?? { dance: 'Dance', camera: 'Camera', face: 'Face', audio: 'Audio', text: 'Text' }[kind],
  };
  return { doc: { ...doc, tracks: [...doc.tracks, track] }, track };
}

export function addSource(doc: TimelineDoc, src: Source): TimelineDoc {
  return doc.sources.some((s) => s.id === src.id) ? doc : { ...doc, sources: [...doc.sources, src] };
}

/** A new clip using the whole source. */
export function newClip(
  trackId: string,
  source: Source | null,
  startFrame: number,
  extra: Partial<Clip> = {},
): Clip {
  return {
    id: clipId(),
    trackId,
    ...(source ? { sourceId: source.id } : {}),
    sourceIn: 0,
    sourceOut: Math.max(1, source?.length ?? 1),
    startFrame: Math.max(0, Math.round(startFrame)),
    speed: 1,
    mirror: false,
    loopCount: 1,
    join: { ...DEFAULT_JOIN },
    ...extra,
  };
}

export function addClip(doc: TimelineDoc, clip: Clip): TimelineDoc {
  return { ...doc, clips: [...doc.clips, clip] };
}

/** First free frame after the last clip of a track. */
export const trackEnd = (doc: TimelineDoc, trackId: string): number =>
  Math.max(0, ...trackClips(doc, trackId).map(clipEnd));

export function moveClip(doc: TimelineDoc, id: string, startFrame: number, trackId?: string): TimelineDoc {
  const c = findClip(doc, id);
  if (!c) return doc;
  const target = trackId ? doc.tracks.find((t) => t.id === trackId) : undefined;
  const from = doc.tracks.find((t) => t.id === c.trackId);
  const okTrack = target && from && target.kind === from.kind ? target.id : c.trackId;
  return mapClip(doc, id, (x) => ({
    ...x,
    startFrame: Math.max(0, Math.round(startFrame)),
    trackId: okTrack,
  }));
}

/**
 * Trim an edge to a timeline frame. The start edge moves the source in-point with it (the content
 * stays put); the end edge moves the out-point. Text clips just change their length.
 */
export function trimClip(
  doc: TimelineDoc,
  id: string,
  edge: 'start' | 'end',
  frame: number,
  sourceLength?: number,
): TimelineDoc {
  const c = findClip(doc, id);
  if (!c) return doc;
  const f = Math.max(0, Math.round(frame));
  if (c.text || !c.sourceId) {
    const end = clipEnd(c);
    if (edge === 'start') {
      const start = Math.min(f, end - 1);
      return mapClip(doc, id, (x) => ({ ...x, startFrame: start, length: end - start }));
    }
    return mapClip(doc, id, (x) => ({ ...x, length: Math.max(1, f - x.startFrame) }));
  }
  const max = sourceLength ?? Infinity;
  if (edge === 'start') {
    if (c.loopCount > 1) return doc;
    const delta = (f - c.startFrame) * c.speed;
    const sourceIn = Math.round(Math.min(c.sourceOut - 1, Math.max(0, c.sourceIn + delta)));
    const startFrame = Math.max(0, c.startFrame + Math.round((sourceIn - c.sourceIn) / c.speed));
    return mapClip(doc, id, (x) => ({ ...x, sourceIn, startFrame }));
  }
  // End edge: shrink / grow the last pass (loops keep their count).
  const local = f - c.startFrame;
  const pass = Math.max(1, Math.round(local / Math.max(1, c.loopCount)));
  const sourceOut = Math.round(Math.min(max, Math.max(c.sourceIn + 1, c.sourceIn + pass * c.speed)));
  return mapClip(doc, id, (x) => ({ ...x, sourceOut }));
}

/**
 * Split at a timeline frame. Single-pass clips split their source range at the exact source frame;
 * looped clips split into whole passes plus partial passes. The pieces join with no fade, so the pose
 * at the cut is continuous.
 */
export function splitClip(doc: TimelineDoc, id: string, frame: number): { doc: TimelineDoc; ids: string[] } {
  const c = findClip(doc, id);
  if (!c) return { doc, ids: [] };
  const t = Math.round(frame) - c.startFrame;
  if (t <= 0 || t >= clipLength(c)) return { doc, ids: [c.id] };
  const seam = { ...c.join, fade: 0, root: 'continue' as const };
  if (c.text || !c.sourceId) {
    const a: Clip = { ...c, length: t };
    const b: Clip = {
      ...c,
      id: clipId(),
      startFrame: c.startFrame + t,
      length: clipLength(c) - t,
      join: seam,
    };
    return replace(doc, c, [a, b]);
  }
  const pass = passLength(c);
  const k = Math.floor(t / pass);
  const r = t - k * pass;
  const cutSrc = Math.round(c.sourceIn + r * c.speed);
  const pieces: Clip[] = [];
  let start = c.startFrame;
  // Pieces that start a new pass rejoin like a loop seam (source placement, seam blend); the piece
  // after the exact cut continues the pose with no fade.
  const passSeam = { ...c.join, fade: LOOP_SEAM, root: 'origin' as const };
  const push = (patch: Partial<Clip>, len: number, join: Clip['join']): void => {
    pieces.push({
      ...c,
      id: pieces.length ? clipId() : c.id,
      startFrame: start,
      ...patch,
      join: pieces.length ? join : c.join,
    });
    start += len;
  };
  if (k > 0) push({ loopCount: k }, k * pass, passSeam);
  if (r > 0) {
    push({ loopCount: 1, sourceOut: cutSrc }, Math.round((cutSrc - c.sourceIn) / c.speed), passSeam);
    push({ loopCount: 1, sourceIn: cutSrc }, Math.round((c.sourceOut - cutSrc) / c.speed), seam);
  }
  const left = c.loopCount - k - (r > 0 ? 1 : 0);
  if (left > 0) push({ loopCount: left }, left * pass, passSeam);
  const firstRight = pieces.findIndex((p) => p.startFrame >= c.startFrame + t);
  const res = replace(doc, c, pieces);
  return { doc: res.doc, ids: [pieces[Math.max(0, firstRight - 1)].id, pieces[Math.max(0, firstRight)].id] };
}

function replace(doc: TimelineDoc, old: Clip, pieces: Clip[]): { doc: TimelineDoc; ids: string[] } {
  const i = doc.clips.findIndex((x) => x.id === old.id);
  const clips = [...doc.clips];
  clips.splice(i, 1, ...pieces);
  return { doc: { ...doc, clips }, ids: pieces.map((p) => p.id) };
}

export function deleteClips(doc: TimelineDoc, ids: readonly string[]): TimelineDoc {
  const set = new Set(ids);
  return { ...doc, clips: doc.clips.filter((c) => !set.has(c.id)) };
}

/** Duplicate right after the original (ripple later clips on the track to make room). */
export function duplicateClip(doc: TimelineDoc, id: string): { doc: TimelineDoc; id: string | null } {
  const c = findClip(doc, id);
  if (!c) return { doc, id: null };
  const len = clipLength(c);
  const end = clipEnd(c);
  const copy: Clip = {
    ...c,
    id: clipId(),
    startFrame: end,
    join: { ...c.join, fade: c.join.fade || DEFAULT_JOIN.fade },
  };
  const clips = doc.clips.map((x) =>
    x.trackId === c.trackId && x.id !== c.id && x.startFrame >= end
      ? { ...x, startFrame: x.startFrame + len }
      : x,
  );
  return { doc: { ...doc, clips: [...clips, copy] }, id: copy.id };
}

/**
 * Move a clip to position `index` in its track's order and lay the track's clips out back to back
 * (ripple), starting where the first clip started.
 */
export function reorderClip(doc: TimelineDoc, id: string, index: number): TimelineDoc {
  const c = findClip(doc, id);
  if (!c) return doc;
  const list = trackClips(doc, c.trackId);
  const from = list.findIndex((x) => x.id === id);
  const to = Math.max(0, Math.min(list.length - 1, index));
  if (from === to) return doc;
  const order = [...list];
  order.splice(to, 0, order.splice(from, 1)[0]);
  let cursor = list[0].startFrame;
  const starts = new Map<string, number>();
  for (const x of order) {
    starts.set(x.id, cursor);
    cursor += clipLength(x);
  }
  return {
    ...doc,
    clips: doc.clips.map((x) => (starts.has(x.id) ? { ...x, startFrame: starts.get(x.id)! } : x)),
  };
}

export const setSpeed = (doc: TimelineDoc, id: string, speed: number): TimelineDoc =>
  mapClip(doc, id, (c) => ({ ...c, speed: Math.min(SPEED_RANGE[1], Math.max(SPEED_RANGE[0], speed)) }));
export const setMirror = (doc: TimelineDoc, id: string, mirror: boolean): TimelineDoc =>
  mapClip(doc, id, (c) => ({ ...c, mirror }));
export const setLoop = (doc: TimelineDoc, id: string, loopCount: number): TimelineDoc =>
  mapClip(doc, id, (c) => ({ ...c, loopCount: Math.max(1, Math.min(64, Math.round(loopCount))) }));
export const setJoin = (doc: TimelineDoc, id: string, join: Partial<Clip['join']>): TimelineDoc =>
  mapClip(doc, id, (c) => ({
    ...c,
    join: { ...c.join, ...join, fade: Math.max(0, Math.round(join.fade ?? c.join.fade)) },
  }));
export const setVolume = (doc: TimelineDoc, id: string, volume: number): TimelineDoc =>
  mapClip(doc, id, (c) => ({ ...c, volume: Math.max(0, Math.min(1, volume)) }));
export const setText = (doc: TimelineDoc, id: string, patch: Partial<TextSpec>): TimelineDoc =>
  mapClip(doc, id, (c) => (c.text ? { ...c, text: { ...c.text, ...patch } } : c));

/** Paste copies of clips at a frame (relative offsets kept), on their own tracks. */
export function pasteClips(
  doc: TimelineDoc,
  clips: readonly Clip[],
  frame: number,
): { doc: TimelineDoc; ids: string[] } {
  if (!clips.length) return { doc, ids: [] };
  const first = Math.min(...clips.map((c) => c.startFrame));
  const copies = clips
    .filter((c) => doc.tracks.some((t) => t.id === c.trackId))
    .map((c) => ({ ...c, id: clipId(), startFrame: Math.max(0, Math.round(frame + c.startFrame - first)) }));
  return { doc: { ...doc, clips: [...doc.clips, ...copies] }, ids: copies.map((c) => c.id) };
}

/** Total timeline length. */
export const timelineEnd = (doc: TimelineDoc): number => Math.max(0, ...doc.clips.map(clipEnd));

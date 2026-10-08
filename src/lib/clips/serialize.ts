// Timeline document validation for project load (unknown JSON → a well-formed TimelineDoc).

import {
  DEFAULT_JOIN,
  DEFAULT_TEXT,
  emptyTimeline,
  type Clip,
  type Source,
  type TextSpec,
  type TimelineDoc,
  type Track,
} from './types';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const str = (v: unknown, fb: string): string => (typeof v === 'string' ? v : fb);
const TRACKS = ['dance', 'camera', 'face', 'audio', 'text'];
const SOURCES = ['motion', 'camera', 'face', 'audio'];

function vec3(v: unknown, fb: [number, number, number]): [number, number, number] {
  return Array.isArray(v) && v.length === 3 ? [num(v[0], fb[0]), num(v[1], fb[1]), num(v[2], fb[2])] : fb;
}

export function parseTextSpec(v: unknown, base: TextSpec = DEFAULT_TEXT): TextSpec {
  if (!isObj(v)) return { ...base };
  const out = { ...base } as Record<string, unknown>;
  for (const [k, def] of Object.entries(base)) {
    const x = v[k];
    if (x === undefined) continue;
    if (Array.isArray(def)) out[k] = vec3(x, def as [number, number, number]);
    else if (typeof def === typeof x) out[k] = x;
  }
  if (typeof v.modelId === 'string') out.modelId = v.modelId;
  if (typeof v.bone === 'string') out.bone = v.bone;
  return out as unknown as TextSpec;
}

export function parseTimeline(json: unknown): TimelineDoc | undefined {
  if (!isObj(json)) return undefined;
  const base = emptyTimeline();
  const tracks: Track[] = (Array.isArray(json.tracks) ? json.tracks : [])
    .filter(
      (t): t is Record<string, unknown> =>
        isObj(t) && typeof t.id === 'string' && TRACKS.includes(t.kind as string),
    )
    .map((t) => ({
      id: t.id as string,
      kind: t.kind as Track['kind'],
      name: str(t.name, String(t.kind)),
      ...(typeof t.modelId === 'string' ? { modelId: t.modelId } : {}),
    }));
  const sources: Source[] = (Array.isArray(json.sources) ? json.sources : [])
    .filter(
      (s): s is Record<string, unknown> =>
        isObj(s) && typeof s.id === 'string' && SOURCES.includes(s.kind as string),
    )
    .map((s) => ({
      id: s.id as string,
      kind: s.kind as Source['kind'],
      name: str(s.name, 'source'),
      length: Math.max(1, num(s.length, 1)),
      ...(isObj(s.ref) && typeof s.ref.blobId === 'string' && typeof s.ref.path === 'string'
        ? { ref: { blobId: s.ref.blobId, path: s.ref.path } }
        : {}),
    }));
  const trackIds = new Set(tracks.map((t) => t.id));
  const sourceIds = new Set(sources.map((s) => s.id));
  const clips: Clip[] = (Array.isArray(json.clips) ? json.clips : [])
    .filter(
      (c): c is Record<string, unknown> =>
        isObj(c) && typeof c.id === 'string' && trackIds.has(c.trackId as string),
    )
    .filter((c) => c.sourceId === undefined || sourceIds.has(c.sourceId as string))
    .map((c) => {
      const join = isObj(c.join) ? c.join : {};
      const clip: Clip = {
        id: c.id as string,
        trackId: c.trackId as string,
        ...(typeof c.sourceId === 'string' ? { sourceId: c.sourceId } : {}),
        sourceIn: Math.max(0, num(c.sourceIn, 0)),
        sourceOut: Math.max(1, num(c.sourceOut, 1)),
        startFrame: Math.max(0, num(c.startFrame, 0)),
        speed: Math.min(4, Math.max(0.25, num(c.speed, 1))),
        mirror: c.mirror === true,
        loopCount: Math.max(1, Math.round(num(c.loopCount, 1))),
        join: {
          fade: Math.max(0, num(join.fade, DEFAULT_JOIN.fade)),
          root: join.root === 'origin' ? 'origin' : 'continue',
          cut: join.cut !== false,
        },
      };
      if (typeof c.volume === 'number') clip.volume = Math.max(0, Math.min(1, c.volume));
      if (typeof c.length === 'number') clip.length = Math.max(1, c.length);
      if (c.text !== undefined) clip.text = parseTextSpec(c.text);
      return clip;
    })
    .filter((c) => c.sourceId !== undefined || c.text !== undefined);
  return { version: 1, tracks, clips, sources, textStyle: parseTextSpec(json.textStyle, base.textStyle) };
}

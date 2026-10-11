/** Light and self-shadow tracks of a VMD, read straight from the buffer. */

export interface LightKey {
  frame: number;
  /** MMD light colour, 0..1 per channel. */
  color: [number, number, number];
  /** MMD light direction (right-handed, Z toward the viewer). */
  direction: [number, number, number];
}

export interface SelfShadowKey {
  frame: number;
  /** 0 = off, 1 = mode 1, 2 = mode 2. */
  mode: number;
  /** MMD shadow range value (0..1 in MMD's UI scale). */
  distance: number;
}

export interface VmdLightTracks {
  light: LightKey[];
  selfShadow: SelfShadowKey[];
}

const HEADER = 30;
const MODEL_NAME = 20;
const BONE_KEY = 111;
const MORPH_KEY = 23;
const CAMERA_KEY = 61;
const LIGHT_KEY = 28;
const SHADOW_KEY = 9;

/** Read the light and self-shadow sections. Returns empty tracks when they are absent or truncated. */
export function readVmdLightTracks(buffer: ArrayBuffer): VmdLightTracks {
  const view = new DataView(buffer);
  const out: VmdLightTracks = { light: [], selfShadow: [] };
  let o = HEADER + MODEL_NAME;
  const count = (): number | null => {
    if (o + 4 > buffer.byteLength) return null;
    const v = view.getUint32(o, true);
    o += 4;
    return v;
  };
  const skip = (n: number | null, size: number): boolean => {
    if (n === null) return false;
    o += n * size;
    return o <= buffer.byteLength;
  };
  if (!skip(count(), BONE_KEY)) return out;
  if (!skip(count(), MORPH_KEY)) return out;
  if (!skip(count(), CAMERA_KEY)) return out;

  const lightCount = count();
  if (lightCount === null || o + lightCount * LIGHT_KEY > buffer.byteLength) return out;
  for (let i = 0; i < lightCount; i++, o += LIGHT_KEY) {
    out.light.push({
      frame: view.getUint32(o, true),
      color: [view.getFloat32(o + 4, true), view.getFloat32(o + 8, true), view.getFloat32(o + 12, true)],
      direction: [
        view.getFloat32(o + 16, true),
        view.getFloat32(o + 20, true),
        view.getFloat32(o + 24, true),
      ],
    });
  }
  out.light.sort((a, b) => a.frame - b.frame);

  const shadowCount = count();
  if (shadowCount === null || o + shadowCount * SHADOW_KEY > buffer.byteLength) return out;
  for (let i = 0; i < shadowCount; i++, o += SHADOW_KEY) {
    out.selfShadow.push({
      frame: view.getUint32(o, true),
      mode: view.getUint8(o + 4),
      distance: view.getFloat32(o + 5, true),
    });
  }
  out.selfShadow.sort((a, b) => a.frame - b.frame);
  return out;
}

export interface LightSample {
  color: [number, number, number];
  direction: [number, number, number];
}

/** Light at a frame: linear between keys, held before the first and after the last. Null when the track is empty. */
export function sampleLight(keys: readonly LightKey[], frame: number): LightSample | null {
  if (keys.length === 0) return null;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (frame <= first.frame) return { color: [...first.color], direction: [...first.direction] };
  if (frame >= last.frame) return { color: [...last.color], direction: [...last.direction] };
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].frame <= frame) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const t = (frame - a.frame) / (b.frame - a.frame);
  const mix = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [
    x[0] + (y[0] - x[0]) * t,
    x[1] + (y[1] - x[1]) * t,
    x[2] + (y[2] - x[2]) * t,
  ];
  return { color: mix(a.color, b.color), direction: mix(a.direction, b.direction) };
}

/** Self-shadow state at a frame: stepped, the latest key at or before the frame. Null before the first key. */
export function sampleSelfShadow(keys: readonly SelfShadowKey[], frame: number): SelfShadowKey | null {
  let found: SelfShadowKey | null = null;
  for (const k of keys) {
    if (k.frame > frame) break;
    found = k;
  }
  return found;
}

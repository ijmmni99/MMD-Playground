/** Pure audio helpers for layers placed on a timeline: when to start a layer, and an offline mix-down. */

export interface LayerTiming {
  /** Timeline second where the layer begins. */
  start: number;
  /** Second in the sound where the layer begins playing. */
  inPoint: number;
  /** Seconds of sound the layer plays. */
  duration: number;
}

export interface PlayPlan {
  /** Seconds from now to start (0 = start immediately). */
  delay: number;
  /** Second in the sound to start from. */
  offset: number;
  /** Seconds left to play. */
  length: number;
}

/** How to play a layer given the timeline position `now`. Null when it has already ended. */
export function playPlan(layer: LayerTiming, now: number): PlayPlan | null {
  const end = layer.start + layer.duration;
  if (layer.duration <= 0 || now >= end) return null;
  if (now < layer.start) return { delay: layer.start - now, offset: layer.inPoint, length: layer.duration };
  const into = now - layer.start;
  return { delay: 0, offset: layer.inPoint + into, length: layer.duration - into };
}

export interface MixLayer extends LayerTiming {
  channels: Float32Array[];
  sampleRate: number;
  gain: number;
}

/**
 * Mix layers into a stereo bed of `totalSeconds` at `sampleRate` (linear resampling, mono is copied to both
 * sides, samples clamp to [-1, 1]).
 */
export function mixLayers(
  layers: readonly MixLayer[],
  totalSeconds: number,
  sampleRate: number,
): Float32Array[] {
  const length = Math.max(0, Math.ceil(totalSeconds * sampleRate));
  const out = [new Float32Array(length), new Float32Array(length)];
  for (const layer of layers) {
    if (!layer.channels.length || layer.duration <= 0) continue;
    const first = Math.max(0, Math.round(layer.start * sampleRate));
    const last = Math.min(length, Math.round((layer.start + layer.duration) * sampleRate));
    for (let side = 0; side < 2; side++) {
      const src = layer.channels[Math.min(side, layer.channels.length - 1)];
      const dst = out[side];
      for (let i = first; i < last; i++) {
        const pos = (layer.inPoint + (i / sampleRate - layer.start)) * layer.sampleRate;
        const j = Math.floor(pos);
        if (j < 0 || j >= src.length - 1) continue;
        const f = pos - j;
        dst[i] += (src[j] * (1 - f) + src[j + 1] * f) * layer.gain;
      }
    }
  }
  for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, ch[i]));
  return out;
}

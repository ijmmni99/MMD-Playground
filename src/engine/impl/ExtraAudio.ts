import { mixLayers, playPlan, type MixLayer } from '@/lib/audioMix';
import type { AudioSync } from './AudioSync';

/** A sound placed on the timeline besides the main music. Times are in seconds. */
export interface ExtraAudioLayer {
  id: string;
  blob: Blob;
  /** Timeline second where it begins. */
  start: number;
  /** Second in the sound where it begins playing. */
  inPoint: number;
  /** Seconds of the sound that play. */
  duration: number;
  /** 0..1+. */
  gain: number;
}

interface Loaded extends ExtraAudioLayer {
  buffer: AudioBuffer | null;
}

/**
 * Sounds that play together with the main music. Each frame it compares the animation clock with what it
 * scheduled and re-schedules after a play, pause, seek or speed change. The main music stays the master
 * clock, so these only follow it.
 */
export class ExtraAudio {
  private layers = new Map<string, Loaded>();
  private nodes: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private version = 0;
  private scheduledVersion = -1;
  private wasPlaying = false;
  private lastTime = 0;
  private lastStamp = 0;
  private lastSpeed = 1;

  constructor(private readonly audio: AudioSync) {}

  get count(): number {
    return this.layers.size;
  }

  /** For diagnostics and tests: layers placed, layers decoded, sounds scheduled right now. */
  get status(): { layers: number; decoded: number; scheduled: number } {
    return {
      layers: this.layers.size,
      decoded: [...this.layers.values()].filter((l) => l.buffer).length,
      scheduled: this.nodes.length,
    };
  }

  /** Replace the layers. New or changed sounds are decoded; unchanged ones keep their buffers. */
  async setLayers(next: readonly ExtraAudioLayer[]): Promise<void> {
    const prev = this.layers;
    const map = new Map<string, Loaded>();
    for (const l of next) {
      const old = prev.get(l.id);
      map.set(l.id, { ...l, buffer: old && old.blob === l.blob ? old.buffer : null });
    }
    this.layers = map;
    this.version++;
    const ctx = this.audio.context;
    await Promise.all(
      [...map.values()]
        .filter((l) => !l.buffer)
        .map(async (l) => {
          try {
            l.buffer = await ctx.decodeAudioData(await l.blob.arrayBuffer());
          } catch {
            l.buffer = null;
          }
        }),
    );
    // Decoding finished: schedule again with the buffers that arrived.
    this.version++;
  }

  /** Call every frame with the animation time in seconds. */
  update(time: number, playing: boolean, speed: number): void {
    const now = performance.now();
    const expected = this.lastTime + ((now - this.lastStamp) / 1000) * this.lastSpeed;
    const jumped = Math.abs(time - expected) > 0.2;
    const changed =
      playing !== this.wasPlaying ||
      this.scheduledVersion !== this.version ||
      speed !== this.lastSpeed ||
      (playing && jumped);
    this.lastTime = time;
    this.lastStamp = now;
    this.lastSpeed = speed;
    this.wasPlaying = playing;
    if (!changed) return;
    this.stopAll();
    this.scheduledVersion = this.version;
    if (!playing || this.layers.size === 0) return;
    const ctx = this.audio.context;
    void ctx.resume();
    for (const l of this.layers.values()) {
      if (!l.buffer) continue;
      const plan = playPlan(l, time);
      if (!plan) continue;
      const src = ctx.createBufferSource();
      src.buffer = l.buffer;
      src.playbackRate.value = speed;
      const gain = ctx.createGain();
      gain.gain.value = l.gain;
      src.connect(gain);
      this.audio.connectOutput(gain);
      src.start(ctx.currentTime + plan.delay / speed, plan.offset, plan.length);
      this.nodes.push({ src, gain });
    }
  }

  private stopAll(): void {
    for (const n of this.nodes) {
      try {
        n.src.stop();
      } catch {
        /* never started */
      }
      n.src.disconnect();
      n.gain.disconnect();
    }
    this.nodes = [];
  }

  /** Decoded layers for an offline mix-down. */
  mixLayers(): MixLayer[] {
    return [...this.layers.values()]
      .filter((l) => l.buffer)
      .map((l) => {
        const b = l.buffer!;
        return {
          channels: Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)),
          sampleRate: b.sampleRate,
          start: l.start,
          inPoint: l.inPoint,
          duration: l.duration,
          gain: l.gain,
        };
      });
  }

  dispose(): void {
    this.stopAll();
    this.layers.clear();
  }
}

/** Mix the main music and extra layers into one stereo AudioBuffer on the timeline. Null when there is nothing. */
export function mixDown(
  main: AudioBuffer | null,
  mainOffsetSeconds: number,
  extra: MixLayer[],
  minSeconds: number,
): AudioBuffer | null {
  const layers: MixLayer[] = [...extra];
  if (main) {
    const inPoint = Math.max(0, mainOffsetSeconds);
    layers.push({
      channels: Array.from({ length: main.numberOfChannels }, (_, i) => main.getChannelData(i)),
      sampleRate: main.sampleRate,
      start: Math.max(0, -mainOffsetSeconds),
      inPoint,
      duration: Math.max(0, main.duration - inPoint),
      gain: 1,
    });
  }
  if (!layers.length) return null;
  const total = Math.max(minSeconds, ...layers.map((l) => l.start + l.duration));
  const rate = main?.sampleRate ?? 44100;
  const data = mixLayers(layers, total, rate);
  const out = new AudioBuffer({ length: data[0].length, numberOfChannels: 2, sampleRate: rate });
  out.copyToChannel(data[0] as Float32Array<ArrayBuffer>, 0);
  out.copyToChannel(data[1] as Float32Array<ArrayBuffer>, 1);
  return out;
}

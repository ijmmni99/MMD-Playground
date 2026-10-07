import type { AudioInfo } from '../types';

/** Drift (s) the animation absorbs by gently changing speed; beyond it the audio is re-seeked. */
const SOFT_DRIFT = 0.5;
/** Drift (s) considered in sync. */
const IN_SYNC = 0.04;
/** Animation speed correction while catching up with the audio. */
const NUDGE = 0.1;
/** After a seek the element needs time to buffer; don't judge drift meanwhile (ms). */
const SEEK_SETTLE_MS = 600;
const PEAKS_PER_SECOND = 100;

/**
 * Keeps an audio element in sync with the animation clock (the MMD runtime is the master).
 * Audio is routed through Web Audio so the recorder can capture it.
 */
export class AudioSync {
  readonly element: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private url: string | null = null;
  buffer: AudioBuffer | null = null;
  offsetSeconds = 0;
  info: AudioInfo | null = null;
  /** When true, the element is kept paused regardless of the animation clock. */
  suspended = false;
  private lastSeekAt = -Infinity;
  /** Last distinct currentTime the element reported and when (smooths coarse clocks, e.g. Safari). */
  private clockTime = -1;
  private clockStamp = 0;

  constructor() {
    this.element = new Audio();
    this.element.preload = 'auto';
    this.element.crossOrigin = 'anonymous';
  }

  get loaded(): boolean {
    return this.url !== null;
  }

  get duration(): number {
    return this.buffer?.duration ?? (Number.isFinite(this.element.duration) ? this.element.duration : 0);
  }

  private ensureGraph(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.source = this.ctx.createMediaElementSource(this.element);
      this.gain = this.ctx.createGain();
      this.streamDest = this.ctx.createMediaStreamDestination();
      this.source.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      this.gain.connect(this.streamDest);
    }
    return this.ctx;
  }

  /** Create/resume the AudioContext and prime the element inside a user gesture (iOS). */
  unlock(): void {
    const ctx = this.ensureGraph();
    if (ctx.state === 'suspended') void ctx.resume();
    if (!this.url) {
      // A silent play/pause on an empty element is enough to unlock HTMLMediaElement on iOS.
      this.element.muted = true;
      this.element.play().then(
        () => {
          this.element.pause();
          this.element.muted = false;
        },
        () => {
          this.element.muted = false;
        },
      );
    }
  }

  async load(blob: Blob, name: string): Promise<AudioInfo> {
    this.unload();
    this.url = URL.createObjectURL(blob);
    this.element.src = this.url;
    const ctx = this.ensureGraph();
    const data = await blob.arrayBuffer();
    try {
      this.buffer = await ctx.decodeAudioData(data);
    } catch {
      this.buffer = null;
      await new Promise<void>((resolve, reject) => {
        this.element.onloadedmetadata = () => resolve();
        this.element.onerror = () => reject(new Error('Unsupported audio format'));
      });
    }
    this.info = {
      name,
      duration: this.duration,
      peaks: this.buffer ? computePeaks(this.buffer, PEAKS_PER_SECOND) : [],
      peaksPerSecond: PEAKS_PER_SECOND,
    };
    return this.info;
  }

  unload(): void {
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.buffer = null;
    this.info = null;
  }

  setVolume(v: number): void {
    if (this.gain) this.gain.gain.value = v;
    else this.element.volume = Math.min(1, Math.max(0, v));
  }

  /**
   * Called every frame with the animation time in seconds. The audio is the master clock while it
   * plays: returns a speed multiplier for the animation (1 = in sync) so small drift is absorbed
   * by the animation instead of re-seeking the audio, which is audible and makes it rebuffer.
   */
  sync(animSeconds: number, playing: boolean, rate: number): number {
    if (!this.url) return 1;
    const target = animSeconds + this.offsetSeconds;
    const shouldPlay = playing && !this.suspended && target >= 0 && target < this.duration;
    if (!shouldPlay) {
      if (!this.element.paused) this.element.pause();
      return 1;
    }
    if (this.element.playbackRate !== rate) this.element.playbackRate = rate;
    const now = performance.now();
    if (this.element.paused) {
      this.seek(target, now);
      void this.ctx?.resume();
      this.element.play().catch(() => undefined);
      return 1;
    }
    // Let a seek or buffering settle before comparing clocks.
    if (this.element.seeking || this.element.readyState < 3 || now - this.lastSeekAt < SEEK_SETTLE_MS) {
      return 1;
    }
    const drift = this.audioTime(now, rate) - target; // > 0: animation is behind the audio
    if (Math.abs(drift) > SOFT_DRIFT * Math.max(1, rate)) {
      this.seek(target, now);
      return 1;
    }
    if (Math.abs(drift) < IN_SYNC) return 1;
    return drift > 0 ? 1 + NUDGE : 1 - NUDGE;
  }

  private seek(time: number, now: number): void {
    this.element.currentTime = time;
    this.lastSeekAt = now;
    this.clockTime = -1;
  }

  /** Element time, extrapolated between the (sometimes coarse) currentTime updates. */
  private audioTime(now: number, rate: number): number {
    const t = this.element.currentTime;
    if (t !== this.clockTime) {
      this.clockTime = t;
      this.clockStamp = now;
      return t;
    }
    return t + Math.min(0.5, ((now - this.clockStamp) / 1000) * rate);
  }

  get mediaStream(): MediaStream | null {
    return this.streamDest?.stream ?? null;
  }

  dispose(): void {
    this.unload();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export function computePeaks(buffer: AudioBuffer, perSecond: number): number[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const block = Math.max(1, Math.floor(buffer.sampleRate / perSecond));
  const count = Math.ceil(buffer.length / block);
  const peaks = new Array<number>(count);
  let max = 0;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const end = Math.min(buffer.length, (i + 1) * block);
    for (const ch of channels) {
      for (let j = i * block; j < end; j += 4) {
        const v = Math.abs(ch[j]);
        if (v > peak) peak = v;
      }
    }
    peaks[i] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) for (let i = 0; i < count; i++) peaks[i] = Math.round((peaks[i] / max) * 1000) / 1000;
  return peaks;
}

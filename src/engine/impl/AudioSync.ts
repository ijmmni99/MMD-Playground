import type { AudioInfo } from '../types';

const DRIFT_TOLERANCE = 0.08;
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

  /** Called every frame with the animation time in seconds. */
  sync(animSeconds: number, playing: boolean, rate: number): void {
    if (!this.url) return;
    const target = animSeconds + this.offsetSeconds;
    const shouldPlay = playing && !this.suspended && target >= 0 && target < this.duration;
    if (!shouldPlay) {
      if (!this.element.paused) this.element.pause();
      return;
    }
    if (this.element.playbackRate !== rate) this.element.playbackRate = rate;
    if (this.element.paused) {
      this.element.currentTime = target;
      void this.ctx?.resume();
      this.element.play().catch(() => undefined);
    } else if (Math.abs(this.element.currentTime - target) > DRIFT_TOLERANCE * Math.max(1, rate)) {
      this.element.currentTime = target;
    }
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

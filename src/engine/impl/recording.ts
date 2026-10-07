import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import type { RecordOptions } from '../types';
import type { RecordProgress } from '../StudioEngine';

class AbortError extends Error {
  constructor() {
    super('Recording cancelled');
    this.name = 'AbortError';
  }
}

interface RealtimeArgs {
  canvas: HTMLCanvasElement;
  options: RecordOptions;
  audioStream: MediaStream | null;
  signal: AbortSignal;
  onProgress: (p: RecordProgress) => void;
  currentFrame: () => number;
  isPlaying: () => boolean;
  begin: () => Promise<void>;
}

/** Realtime capture via MediaRecorder (canvas stream + Web Audio stream). */
export async function recordRealtime(a: RealtimeArgs): Promise<Blob> {
  const { options: o } = a;
  const video = a.canvas.captureStream(o.fps);
  const tracks: MediaStreamTrack[] = [...video.getVideoTracks()];
  if (a.audioStream) tracks.push(...a.audioStream.getAudioTracks());
  const stream = new MediaStream(tracks);
  const recorder = new MediaRecorder(stream, { mimeType: o.mimeType, videoBitsPerSecond: o.bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start(250);
  await a.begin();
  const total = Math.max(1, o.endFrame - o.startFrame);
  await new Promise<void>((resolve, reject) => {
    const poll = setInterval(() => {
      const f = a.currentFrame();
      a.onProgress({ phase: 'recording', progress: Math.min(1, (f - o.startFrame) / total), frame: f });
      if (a.signal.aborted) {
        clearInterval(poll);
        reject(new AbortError());
      } else if (f >= o.endFrame || !a.isPlaying()) {
        clearInterval(poll);
        resolve();
      }
    }, 100);
  }).finally(() => {
    if (recorder.state !== 'inactive') recorder.stop();
    video.getTracks().forEach((t) => t.stop());
  });
  await stopped;
  a.onProgress({ phase: 'done', progress: 1, frame: o.endFrame });
  return new Blob(chunks, { type: o.mimeType.split(';')[0] });
}

interface DeterministicArgs {
  canvas: HTMLCanvasElement;
  options: RecordOptions;
  audioBuffer: AudioBuffer | null;
  audioOffset: number;
  signal: AbortSignal;
  onProgress: (p: RecordProgress) => void;
  renderFrame: () => void;
  begin: () => Promise<void>;
}

export function deterministicSupported(): boolean {
  return typeof VideoEncoder !== 'undefined';
}

/**
 * Frame-stepped capture with WebCodecs: every output frame is rendered with a fixed delta time
 * and encoded with an exact timestamp, so the result is independent of rendering speed.
 */
export async function recordDeterministic(a: DeterministicArgs): Promise<Blob> {
  const { options: o } = a;
  const mp4 = o.mimeType.includes('mp4');
  const videoCodecs: VideoCodec[] = mp4 ? ['avc', 'hevc', 'av1'] : ['vp9', 'vp8', 'av1'];
  let videoCodec: VideoCodec | null = null;
  for (const c of videoCodecs) {
    if (await canEncodeVideo(c, { width: o.width, height: o.height, bitrate: o.bitrate })) {
      videoCodec = c;
      break;
    }
  }
  if (!videoCodec) throw new Error(`No ${mp4 ? 'MP4' : 'WebM'} video encoder available in this browser`);
  const audioCodecs: AudioCodec[] = mp4 ? ['aac', 'opus'] : ['opus', 'vorbis'];
  let audioCodec: AudioCodec | null = null;
  if (a.audioBuffer) {
    for (const c of audioCodecs) {
      if (await canEncodeAudio(c, { numberOfChannels: a.audioBuffer.numberOfChannels, sampleRate: a.audioBuffer.sampleRate })) {
        audioCodec = c;
        break;
      }
    }
  }

  const target = new BufferTarget();
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
  const videoSource = new CanvasSource(a.canvas, { codec: videoCodec, bitrate: o.bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: o.fps });
  let audioSource: AudioBufferSource | null = null;
  if (audioCodec && a.audioBuffer) {
    audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
    output.addAudioTrack(audioSource);
  }
  await output.start();

  const frameCount = Math.max(1, Math.round(((o.endFrame - o.startFrame) / 30) * o.fps));
  await a.begin();
  try {
    for (let i = 0; i < frameCount; i++) {
      if (a.signal.aborted) throw new AbortError();
      a.renderFrame();
      await videoSource.add(i / o.fps, 1 / o.fps);
      if (i % 5 === 0) {
        a.onProgress({ phase: 'recording', progress: i / frameCount, frame: o.startFrame + (i / o.fps) * 30 });
        // yield so the UI can update
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (audioSource && a.audioBuffer) {
      const slice = sliceAudio(a.audioBuffer, o.startFrame / 30 + a.audioOffset, frameCount / o.fps);
      if (slice) await audioSource.add(slice);
    }
    a.onProgress({ phase: 'encoding', progress: 1, frame: o.endFrame });
    await output.finalize();
  } catch (err) {
    await output.cancel();
    throw err;
  }
  a.onProgress({ phase: 'done', progress: 1, frame: o.endFrame });
  return new Blob([target.buffer!], { type: mp4 ? 'video/mp4' : 'video/webm' });
}

/** Cut [start, start+duration) out of an AudioBuffer, padding with silence where out of range. */
export function sliceAudio(buffer: AudioBuffer, start: number, duration: number): AudioBuffer | null {
  const rate = buffer.sampleRate;
  const length = Math.max(1, Math.round(duration * rate));
  const out = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: rate });
  const startSample = Math.round(start * rate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    const from = Math.max(0, startSample);
    const to = Math.min(src.length, startSample + length);
    if (to > from) dst.set(src.subarray(from, to), from - startSample);
  }
  return out;
}

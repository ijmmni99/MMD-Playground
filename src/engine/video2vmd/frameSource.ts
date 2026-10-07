import type { CropBox, VideoInfo } from './types';

/** A decoded frame, already cropped and scaled to the analysis size. Valid until the next frame. */
export interface AnalysedFrame {
  /** Source time in seconds. */
  time: number;
  canvas: OffscreenCanvas | HTMLCanvasElement;
}

export interface FrameRange {
  start: number;
  end: number;
  /** Target sampling rate; frames are skipped to stay at or below it. */
  fps: number;
}

export interface FrameSource {
  readonly kind: 'webcodecs' | 'seek';
  /** Analysis size in pixels after crop + downscale. */
  readonly size: [number, number];
  frames(range: FrameRange, signal: AbortSignal): AsyncGenerator<AnalysedFrame>;
  dispose(): void;
}

/** Pixel size of the analysed area for a crop and a maximum long edge. */
export function analysisSize(
  width: number,
  height: number,
  crop: CropBox | null,
  maxLongEdge: number,
): [number, number] {
  const cw = (crop?.w ?? 1) * width;
  const ch = (crop?.h ?? 1) * height;
  const s = Math.min(1, maxLongEdge / Math.max(cw, ch));
  return [Math.max(16, Math.round(cw * s)), Math.max(16, Math.round(ch * s))];
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const ctx2d = (c: OffscreenCanvas | HTMLCanvasElement): Ctx2D =>
  c.getContext('2d', { willReadFrequently: false }) as Ctx2D;

/** Read container metadata (works without WebCodecs). */
export async function probeVideo(file: Blob, name: string): Promise<VideoInfo & { decodable: boolean }> {
  try {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found in this file.');
    const [duration, stats, audio, decodable] = await Promise.all([
      input.computeDuration(),
      track.computePacketStats(120),
      input.getPrimaryAudioTrack(),
      typeof VideoDecoder !== 'undefined' ? track.canDecode() : Promise.resolve(false),
    ]);
    return {
      name,
      width: track.displayWidth,
      height: track.displayHeight,
      fps: Math.round((stats.averagePacketRate || 30) * 100) / 100,
      duration,
      hasAudio: !!audio,
      codec: track.codec ?? undefined,
      decodable,
    };
  } catch (e) {
    if (typeof document === 'undefined') throw e;
    // Fallback: let the browser's media stack read it.
    const info = await probeWithElement(file, name);
    return { ...info, decodable: false };
  }
}

function probeWithElement(file: Blob, name: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const url = URL.createObjectURL(file);
    v.src = url;
    v.onloadedmetadata = () => {
      resolve({
        name,
        width: v.videoWidth,
        height: v.videoHeight,
        fps: 30,
        duration: v.duration,
        hasAudio: true,
      });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          'This video format or codec cannot be decoded by your browser. Convert it to MP4 (H.264 video, AAC audio) or WebM (VP9) and try again.',
        ),
      );
    };
  });
}

/** Frame-accurate decoding with WebCodecs (via mediabunny). Usable inside a Worker. */
export async function createWebCodecsSource(
  file: Blob,
  crop: CropBox | null,
  maxLongEdge: number,
): Promise<FrameSource> {
  const { Input, BlobSource, ALL_FORMATS, VideoSampleSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track found in this file.');
  if (!(await track.canDecode())) {
    throw new Error(
      `This browser cannot decode ${track.codec ?? 'this'} video. Convert it to MP4 (H.264) or WebM (VP9) and try again.`,
    );
  }
  const W = track.displayWidth;
  const H = track.displayHeight;
  const size = analysisSize(W, H, crop, maxLongEdge);
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  // Full frame at the scale needed so the crop lands at the analysis size.
  const fullScale = size[0] / (c.w * W);
  const full = makeCanvas(Math.max(1, Math.round(W * fullScale)), Math.max(1, Math.round(H * fullScale)));
  const out = makeCanvas(size[0], size[1]);
  const fullCtx = ctx2d(full);
  const outCtx = ctx2d(out);
  const sink = new VideoSampleSink(track);

  return {
    kind: 'webcodecs',
    size,
    async *frames(range, signal) {
      const minStep = 1 / range.fps - 1e-4;
      let last = -Infinity;
      for await (const sample of sink.samples(range.start, range.end)) {
        try {
          if (signal.aborted) return;
          if (sample.timestamp - last < minStep) continue;
          last = sample.timestamp;
          fullCtx.clearRect(0, 0, full.width, full.height);
          sample.drawWithFit(fullCtx as OffscreenCanvasRenderingContext2D, { fit: 'fill' });
          outCtx.drawImage(
            full as CanvasImageSource,
            c.x * full.width,
            c.y * full.height,
            c.w * full.width,
            c.h * full.height,
            0,
            0,
            size[0],
            size[1],
          );
          yield { time: sample.timestamp, canvas: out };
        } finally {
          sample.close();
        }
      }
    },
    dispose() {
      input.dispose?.();
    },
  };
}

/** Fallback: deterministic seeking on a <video> element (main thread only). */
export async function createSeekSource(
  file: Blob,
  info: VideoInfo,
  crop: CropBox | null,
  maxLongEdge: number,
): Promise<FrameSource> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(file);
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () =>
      reject(
        new Error(
          'This video cannot be decoded by your browser. Convert it to MP4 (H.264) or WebM (VP9) and try again.',
        ),
      );
  });
  const W = video.videoWidth || info.width;
  const H = video.videoHeight || info.height;
  const size = analysisSize(W, H, crop, maxLongEdge);
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const out = makeCanvas(size[0], size[1]);
  const outCtx = ctx2d(out);

  const seek = (t: number): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        video.removeEventListener('seeked', done);
        // Make sure the decoded frame is the one presented.
        const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })
          .requestVideoFrameCallback;
        if (rvfc && !video.paused) rvfc.call(video, () => resolve());
        else resolve();
      };
      video.addEventListener('seeked', done);
      video.currentTime = t;
    });

  return {
    kind: 'seek',
    size,
    async *frames(range, signal) {
      const step = 1 / range.fps;
      for (let t = range.start; t < range.end - 1e-6; t += step) {
        if (signal.aborted) return;
        // Seek slightly into the frame to avoid landing on the previous one.
        await seek(Math.min(t + step * 0.25, Math.max(0, video.duration - 0.001)));
        outCtx.drawImage(video, c.x * W, c.y * H, c.w * W, c.h * H, 0, 0, size[0], size[1]);
        yield { time: t, canvas: out };
      }
    },
    dispose() {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

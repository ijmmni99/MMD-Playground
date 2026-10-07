export type ResolutionId = '720p' | '1080p' | '1440p' | '4k' | 'vertical' | 'square' | 'viewport' | 'custom';

export function resolutionFor(id: ResolutionId, custom: [number, number]): [number, number] {
  switch (id) {
    case '720p':
      return [1280, 720];
    case '1080p':
      return [1920, 1080];
    case '1440p':
      return [2560, 1440];
    case '4k':
      return [3840, 2160];
    case 'vertical':
      return [1080, 1920];
    case 'square':
      return [1080, 1080];
    case 'viewport': {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="viewport-canvas"]');
      const dpr = window.devicePixelRatio || 1;
      // Encoders need even dimensions.
      const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
      return c ? [even(c.clientWidth * dpr), even(c.clientHeight * dpr)] : [1920, 1080];
    }
    case 'custom':
      return [Math.round(custom[0] / 2) * 2, Math.round(custom[1] / 2) * 2];
  }
}

export interface VideoFormat {
  id: string;
  label: string;
  mimeType: string;
  ext: string;
  deterministic: boolean;
  description: string;
}

/** Formats this browser can produce, best first. */
export function supportedFormats(): VideoFormat[] {
  const out: VideoFormat[] = [];
  const webCodecs = typeof VideoEncoder !== 'undefined';
  if (webCodecs) {
    out.push({
      id: 'mp4-steps',
      label: 'MP4 (H.264) · frame-stepped',
      mimeType: 'video/mp4',
      ext: 'mp4',
      deterministic: true,
      description: 'Renders every frame offline with WebCodecs — perfectly smooth, physics-accurate, audio muxed.',
    });
    out.push({
      id: 'webm-steps',
      label: 'WebM (VP9) · frame-stepped',
      mimeType: 'video/webm',
      ext: 'webm',
      deterministic: true,
      description: 'Offline WebCodecs render to WebM (VP9 + Opus).',
    });
  }
  if (typeof MediaRecorder !== 'undefined') {
    const candidates: [string, string, string][] = [
      ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'MP4 · realtime', 'mp4'],
      ['video/mp4', 'MP4 · realtime', 'mp4'],
      ['video/webm;codecs=vp9,opus', 'WebM (VP9) · realtime', 'webm'],
      ['video/webm;codecs=vp8,opus', 'WebM (VP8) · realtime', 'webm'],
      ['video/webm', 'WebM · realtime', 'webm'],
    ];
    const seen = new Set<string>();
    for (const [mime, label, ext] of candidates) {
      if (seen.has(label)) continue;
      if (MediaRecorder.isTypeSupported(mime)) {
        seen.add(label);
        out.push({
          id: `rt-${mime}`,
          label,
          mimeType: mime,
          ext,
          deterministic: false,
          description: 'MediaRecorder capture of the live canvas + audio while playing in real time.',
        });
      }
    }
  }
  return out;
}

// Texture recolouring on raw RGBA pixels (pure, unit-tested) plus the canvas glue for the browser:
// HSV shift, tint, logo / pattern compositing and downscaling. Alpha is always preserved.

export interface Recolor {
  /** Hue shift in degrees. */
  hue: number;
  /** Saturation multiplier (1 = unchanged). */
  saturation: number;
  /** Value (brightness) multiplier. */
  value: number;
  /** Tint colour (0–1 RGB) and amount (0 = none, 1 = fully tinted, keeping shading). */
  tint?: [number, number, number];
  tintAmount?: number;
}

export const NO_RECOLOR: Recolor = { hue: 0, saturation: 1, value: 1 };
export const isNoRecolor = (r: Recolor): boolean =>
  r.hue === 0 && r.saturation === 1 && r.value === 1 && !(r.tint && (r.tintAmount ?? 0) > 0);

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] =
    hh < 1
      ? [c, x, 0]
      : hh < 2
        ? [x, c, 0]
        : hh < 3
          ? [0, c, x]
          : hh < 4
            ? [0, x, c]
            : hh < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = v - c;
  return [r + m, g + m, b + m];
}

/** Recolour one RGB colour (0–1). */
export function recolorRgb(rgb: [number, number, number], r: Recolor): [number, number, number] {
  const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  let out = hsvToRgb(h + r.hue, Math.min(1, s * r.saturation), Math.min(1, v * r.value));
  const t = r.tint && r.tintAmount ? Math.max(0, Math.min(1, r.tintAmount)) : 0;
  if (t > 0 && r.tint) {
    // Tint keeps the shading: luminance × tint colour, blended in.
    const lum = 0.299 * out[0] + 0.587 * out[1] + 0.114 * out[2];
    const tinted = r.tint.map((c) => Math.min(1, c * lum * 1.6)) as [number, number, number];
    out = [0, 1, 2].map((i) => out[i] * (1 - t) + tinted[i] * t) as [number, number, number];
  }
  return out;
}

/** Recolour RGBA pixels in place. */
export function recolorPixels(px: Uint8ClampedArray, r: Recolor): void {
  if (isNoRecolor(r)) return;
  // Cache per colour: textures usually have few distinct colours.
  const cache = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let packed = cache.get(key);
    if (packed === undefined) {
      const o = recolorRgb([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255], r);
      packed = (Math.round(o[0] * 255) << 16) | (Math.round(o[1] * 255) << 8) | Math.round(o[2] * 255);
      if (cache.size < 65536) cache.set(key, packed);
    }
    px[i] = (packed >> 16) & 0xff;
    px[i + 1] = (packed >> 8) & 0xff;
    px[i + 2] = packed & 0xff;
  }
}

// ------------------------------------------------------------------ browser glue

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Canvas2D } {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as Canvas2D | null;
  if (!ctx) throw new Error('Canvas 2D is not available');
  return { canvas, ctx };
}

async function toPng(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement)
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'),
    );
  return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
}

/** Decode an image (PNG / JPG / BMP / WebP…). TGA / DDS are not decodable by browsers. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

export async function recolorImage(blob: Blob, r: Recolor): Promise<Blob> {
  const bmp = await decodeImage(blob);
  try {
    const { canvas, ctx } = makeCanvas(bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
    recolorPixels(data.data, r);
    ctx.putImageData(data, 0, 0);
    return toPng(canvas);
  } finally {
    bmp.close();
  }
}

export interface Overlay {
  /** Centre in UV space (0–1, v down as in the image). */
  u: number;
  v: number;
  /** Width as a fraction of the texture width. */
  size: number;
  /** 'over' = draw on top (logo), 'tile' = repeat as a pattern multiplied with the texture. */
  mode: 'over' | 'tile';
  opacity: number;
}

/** Composite an uploaded logo / pattern into a texture (or a blank one of `size` when there is none). */
export async function compositeImage(
  base: Blob | null,
  overlay: Blob,
  o: Overlay,
  size = 1024,
): Promise<Blob> {
  const bmp = base ? await decodeImage(base) : null;
  const ov = await decodeImage(overlay);
  try {
    const w = bmp?.width ?? size;
    const h = bmp?.height ?? size;
    const { canvas, ctx } = makeCanvas(w, h);
    if (bmp) ctx.drawImage(bmp, 0, 0);
    else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, o.opacity));
    const ow = Math.max(1, o.size * w);
    const oh = (ov.height / ov.width) * ow;
    if (o.mode === 'tile') {
      ctx.globalCompositeOperation = 'multiply';
      for (let y = 0; y < h; y += oh) for (let x = 0; x < w; x += ow) ctx.drawImage(ov, x, y, ow, oh);
    } else ctx.drawImage(ov, o.u * w - ow / 2, o.v * h - oh / 2, ow, oh);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Keep the base texture's alpha (cut-outs stay cut out).
    if (bmp) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(bmp, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    return toPng(canvas);
  } finally {
    bmp?.close();
    ov.close();
  }
}

/** Image size (0×0 when it can't be decoded, e.g. TGA). */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const b = await decodeImage(blob);
    const s = { width: b.width, height: b.height };
    b.close();
    return s;
  } catch {
    return { width: 0, height: 0 };
  }
}

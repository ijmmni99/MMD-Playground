/** Size that fits inside `cap`×`cap` keeping aspect ratio (never upscales, integers ≥ 1). */
export function fitWithin(
  width: number,
  height: number,
  cap: number,
): { width: number; height: number; scaled: boolean } {
  const longest = Math.max(width, height);
  if (longest <= cap || longest <= 0) return { width, height, scaled: false };
  const k = cap / longest;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
    scaled: true,
  };
}

/** Formats the browser can decode itself (and that we can therefore re-encode). */
export const DOWNSCALABLE = /\.(png|jpe?g|bmp|gif|webp)$/i;

/**
 * Downscale an image blob so its longest side is ≤ cap. Returns the original blob when it already
 * fits, cannot be decoded, or the environment lacks the APIs (keeps loading robust).
 */
export async function downscaleImage(blob: Blob, name: string, cap: number): Promise<Blob> {
  if (!DOWNSCALABLE.test(name) || typeof createImageBitmap !== 'function') return blob;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return blob;
  }
  const target = fitWithin(bitmap.width, bitmap.height, cap);
  if (!target.scaled) {
    bitmap.close();
    return blob;
  }
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(target.width, target.height)
        : Object.assign(document.createElement('canvas'), { width: target.width, height: target.height });
    const ctx = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return blob;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    // PNG keeps alpha (many MMD textures rely on it).
    if (canvas instanceof HTMLCanvasElement) {
      return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? blob), 'image/png'));
    }
    return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

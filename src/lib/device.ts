/** Device capability helpers (safe to call in tests / SSR). */
export const isCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

/** navigator.deviceMemory in GB (Chromium only); undefined elsewhere. */
export const deviceMemoryGB = (): number | undefined =>
  typeof navigator !== 'undefined' ? (navigator as { deviceMemory?: number }).deviceMemory : undefined;

/** Phones/tablets and devices reporting ≤ 4 GB RAM are treated as memory-constrained. */
export function isLowMemoryDevice(memory = deviceMemoryGB(), coarse = isCoarsePointer()): boolean {
  if (memory !== undefined) return memory <= 4;
  return coarse;
}

export const LARGE_MODEL_BYTES = 30 * 1024 * 1024;

/** Texture size cap for the current device/quality, or null for no cap (desktop). */
export function textureCap(quality: 'low' | 'medium' | 'high', coarse = isCoarsePointer()): number | null {
  if (!coarse) return null;
  return quality === 'low' ? 1024 : 2048;
}

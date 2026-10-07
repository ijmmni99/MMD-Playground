/** Subtle haptic tick where supported (Android Chrome). No-op elsewhere or with reduced motion. */
export function haptic(ms = 8): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}

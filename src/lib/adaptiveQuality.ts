export interface AdaptiveOptions {
  /** Step down when FPS stays below this… */
  threshold: number;
  /** …for this long (ms). */
  window: number;
  /** Minimum time between two step-downs (ms), so the new setting can settle. */
  cooldown: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveOptions = { threshold: 30, window: 3000, cooldown: 4000 };

/**
 * Watches FPS samples and says when to lower quality. Pure (time is passed in) so it can be
 * unit-tested; samples of 0 (paused / hidden) reset the window instead of counting as slow.
 */
export class AdaptiveQualityController {
  private belowSince: number | null = null;
  private lastAction = -Infinity;

  constructor(private readonly opts: AdaptiveOptions = DEFAULT_ADAPTIVE) {}

  /** Returns true when quality should be stepped down now. */
  sample(fps: number, now: number): boolean {
    if (!(fps > 0)) {
      this.belowSince = null;
      return false;
    }
    if (fps >= this.opts.threshold) {
      this.belowSince = null;
      return false;
    }
    if (this.belowSince === null) {
      this.belowSince = now;
      return false;
    }
    if (now - this.belowSince >= this.opts.window && now - this.lastAction >= this.opts.cooldown) {
      this.lastAction = now;
      this.belowSince = null;
      return true;
    }
    return false;
  }

  reset(): void {
    this.belowSince = null;
  }
}

export type QualityStep = { quality: 'high' | 'medium' | 'low'; softShadows: boolean; shadows: boolean };

/** Next cheaper configuration, or null when already at the floor. */
export function nextLowerQuality(s: QualityStep): QualityStep | null {
  if (s.quality === 'high') return { ...s, quality: 'medium' };
  if (s.quality === 'medium') return { ...s, quality: 'low' };
  if (s.softShadows) return { ...s, softShadows: false };
  if (s.shadows) return { ...s, shadows: false };
  return null;
}

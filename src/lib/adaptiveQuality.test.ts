import { describe, expect, it } from 'vitest';
import { AdaptiveQualityController, nextLowerQuality } from './adaptiveQuality';

describe('AdaptiveQualityController', () => {
  it('steps down after 3 s below 30 fps', () => {
    const c = new AdaptiveQualityController();
    expect(c.sample(20, 0)).toBe(false);
    expect(c.sample(22, 1500)).toBe(false);
    expect(c.sample(25, 2999)).toBe(false);
    expect(c.sample(25, 3000)).toBe(true);
  });

  it('resets when the frame rate recovers', () => {
    const c = new AdaptiveQualityController();
    c.sample(20, 0);
    c.sample(45, 2000);
    expect(c.sample(20, 3500)).toBe(false);
    expect(c.sample(20, 6500)).toBe(true);
  });

  it('ignores paused/hidden samples (fps 0)', () => {
    const c = new AdaptiveQualityController();
    c.sample(20, 0);
    c.sample(0, 2000);
    expect(c.sample(20, 3200)).toBe(false);
  });

  it('respects the cooldown between steps', () => {
    const c = new AdaptiveQualityController({ threshold: 30, window: 1000, cooldown: 5000 });
    c.sample(10, 0);
    expect(c.sample(10, 1000)).toBe(true);
    c.sample(10, 1100);
    expect(c.sample(10, 2200)).toBe(false); // in cooldown
    expect(c.sample(10, 6100)).toBe(true);
  });
});

describe('nextLowerQuality', () => {
  it('walks high → medium → low → no soft shadows → no shadows → floor', () => {
    let s = { quality: 'high' as const, softShadows: true, shadows: true } as Parameters<
      typeof nextLowerQuality
    >[0];
    const seen: string[] = [];
    for (let next = nextLowerQuality(s); next; next = nextLowerQuality(s)) {
      s = next;
      seen.push(`${s.quality}/${s.softShadows}/${s.shadows}`);
    }
    expect(seen).toEqual(['medium/true/true', 'low/true/true', 'low/false/true', 'low/false/false']);
  });
});

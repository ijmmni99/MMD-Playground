import { describe, expect, it } from 'vitest';
import { computeLayoutMode, isPhoneMode } from './layoutMode';

describe('computeLayoutMode (breakpoints)', () => {
  it.each([
    [390, 844, 'phone'],
    [360, 640, 'phone'],
    [639, 900, 'phone'],
    [844, 390, 'phone-landscape'],
    [932, 430, 'phone-landscape'],
    [640, 900, 'tablet'],
    [768, 1024, 'tablet'],
    [1024, 768, 'tablet'],
    [1025, 768, 'desktop'],
    [1440, 900, 'desktop'],
    [1280, 480, 'desktop'],
  ] as const)('%ix%i → %s', (w, h, mode) => {
    expect(computeLayoutMode(w, h)).toBe(mode);
  });

  it('treats a short square-ish window as phone, not landscape', () => {
    expect(computeLayoutMode(450, 480)).toBe('phone');
  });

  it('classifies phone modes', () => {
    expect(isPhoneMode('phone')).toBe(true);
    expect(isPhoneMode('phone-landscape')).toBe(true);
    expect(isPhoneMode('tablet')).toBe(false);
  });
});

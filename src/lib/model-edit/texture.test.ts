import { describe, expect, it } from 'vitest';
import { hsvToRgb, NO_RECOLOR, recolorPixels, recolorRgb, rgbToHsv } from './texture';

describe('texture recolour', () => {
  it('HSV round-trips', () => {
    for (const c of [
      [1, 0, 0],
      [0.2, 0.6, 0.9],
      [0.5, 0.5, 0.5],
      [0, 0, 0],
    ] as [number, number, number][]) {
      const back = hsvToRgb(...rgbToHsv(...c));
      back.forEach((x, i) => expect(x).toBeCloseTo(c[i], 6));
    }
  });

  it('hue shift turns red into green / blue, keeps greys and alpha', () => {
    expect(recolorRgb([1, 0, 0], { ...NO_RECOLOR, hue: 120 }).map((x) => +x.toFixed(3))).toEqual([0, 1, 0]);
    expect(recolorRgb([1, 0, 0], { ...NO_RECOLOR, hue: 240 }).map((x) => +x.toFixed(3))).toEqual([0, 0, 1]);
    const px = new Uint8ClampedArray([255, 0, 0, 128, 128, 128, 128, 255]);
    recolorPixels(px, { ...NO_RECOLOR, hue: 120 });
    expect(Array.from(px)).toEqual([0, 255, 0, 128, 128, 128, 128, 255]);
  });

  it('tint keeps shading, saturation 0 makes grey, no-op leaves pixels', () => {
    const dark = recolorRgb([0.2, 0.2, 0.2], { ...NO_RECOLOR, tint: [1, 0, 0], tintAmount: 1 });
    const light = recolorRgb([0.8, 0.8, 0.8], { ...NO_RECOLOR, tint: [1, 0, 0], tintAmount: 1 });
    expect(light[0]).toBeGreaterThan(dark[0]);
    expect(dark[1]).toBe(0);
    const g = recolorRgb([0.9, 0.3, 0.1], { ...NO_RECOLOR, saturation: 0 });
    expect(g[0]).toBeCloseTo(g[2], 6);
    const px = new Uint8ClampedArray([10, 20, 30, 40]);
    recolorPixels(px, NO_RECOLOR);
    expect(Array.from(px)).toEqual([10, 20, 30, 40]);
  });
});

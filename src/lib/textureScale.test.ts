import { describe, expect, it } from 'vitest';
import { fitWithin, downscaleImage } from './textureScale';
import { isLowMemoryDevice, textureCap } from './device';

describe('texture downscaling', () => {
  it('fits within the cap keeping aspect ratio', () => {
    expect(fitWithin(4096, 2048, 2048)).toEqual({ width: 2048, height: 1024, scaled: true });
    expect(fitWithin(1000, 3000, 1024)).toEqual({ width: 341, height: 1024, scaled: true });
    expect(fitWithin(512, 512, 1024)).toEqual({ width: 512, height: 512, scaled: false });
    expect(fitWithin(5000, 1, 1024).height).toBe(1);
  });

  it('caps textures only on touch devices', () => {
    expect(textureCap('low', true)).toBe(1024);
    expect(textureCap('medium', true)).toBe(2048);
    expect(textureCap('high', true)).toBe(2048);
    expect(textureCap('low', false)).toBeNull();
  });

  it('detects low-memory devices', () => {
    expect(isLowMemoryDevice(2, false)).toBe(true);
    expect(isLowMemoryDevice(8, true)).toBe(false);
    expect(isLowMemoryDevice(undefined, true)).toBe(true);
    expect(isLowMemoryDevice(undefined, false)).toBe(false);
  });

  it('leaves non-decodable formats untouched', async () => {
    const tga = new Blob(['x']);
    expect(await downscaleImage(tga, 'face.tga', 16)).toBe(tga);
  });
});

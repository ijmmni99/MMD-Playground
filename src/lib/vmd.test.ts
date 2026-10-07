import { describe, expect, it } from 'vitest';
import { fixtureBuffer } from '@/test/fixtures';
import { summarizeVmd } from './vmd';

describe('summarizeVmd', () => {
  it('detects model motions', () => {
    const s = summarizeVmd(fixtureBuffer('dance.vmd'));
    expect(s.boneKeyCount).toBeGreaterThan(0);
    expect(s.morphKeyCount).toBeGreaterThan(0);
    expect(s.isCamera).toBe(false);
  });
  it('detects camera motions', () => {
    const s = summarizeVmd(fixtureBuffer('camera.vmd'));
    expect(s.cameraKeyCount).toBe(9);
    expect(s.isCamera).toBe(true);
  });
  it('rejects non-VMD data', () => {
    expect(() => summarizeVmd(new TextEncoder().encode('hello world, not a vmd file').buffer as ArrayBuffer)).toThrow();
  });
});

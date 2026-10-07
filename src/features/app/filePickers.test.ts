import { describe, expect, it } from 'vitest';
import { acceptFor } from './filePickers';

describe('acceptFor', () => {
  it('drops extension filters iOS cannot map, keeps MIME types', () => {
    expect(acceptFor('model', true)).toBe('');
    expect(acceptFor('motion', true)).toBe('');
    expect(acceptFor('audio', true)).toBe('audio/*');
    expect(acceptFor('zip', true)).toContain('application/zip');
  });
  it('uses precise lists elsewhere', () => {
    expect(acceptFor('motion', false)).toBe('.vmd');
    expect(acceptFor('model', false)).toContain('.pmx');
    expect(acceptFor('audio', false)).toContain('.mp3');
  });
});

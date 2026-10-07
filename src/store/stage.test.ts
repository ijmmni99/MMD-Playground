import { describe, expect, it } from 'vitest';
import { looksLikeStage } from './actions';

describe('looksLikeStage', () => {
  it('detects stage-like names', () => {
    expect(looksLikeStage('Classroom Stage')).toBe(true);
    expect(looksLikeStage('foo', 'ステージ.pmx')).toBe(true);
    expect(looksLikeStage('舞台セット')).toBe(true);
    expect(looksLikeStage('x', 'y', 'Stages/Beach/beach.pmx')).toBe(true);
  });
  it('leaves characters alone', () => {
    expect(looksLikeStage('初音ミク', 'miku.pmx', 'Miku/miku.pmx')).toBe(false);
    expect(looksLikeStage('ブロッキー', 'blocky.pmx')).toBe(false);
  });
});

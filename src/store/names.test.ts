import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '@/engine/types';
import {
  getLabels,
  getNameTable,
  importLabels,
  labelKeyFor,
  resetAllLabels,
  resetLabel,
  setLabel,
  useNames,
} from './names';
import { studio, type ModelUI } from './studio';

const info: ModelInfo = {
  id: 'm1',
  name: 'Test',
  fileName: 'test.pmx',
  bones: [
    { index: 0, name: '左腕', parent: -1, physics: false },
    { index: 1, name: '謎', parent: 0, physics: false },
  ],
  morphs: [{ index: 0, name: 'まばたき', category: 'eye' }],
  materials: [{ index: 0, name: '顔', visible: true, outline: true, alpha: 1 }],
  rigidBodyCount: 0,
  missingTextures: [],
  vertexCount: 0,
};

describe('label overrides', () => {
  it('rename, reset, reset all, import — Japanese ids untouched', () => {
    studio.set({ models: [{ id: 'm1', name: 'Test', info } as unknown as ModelUI] });
    setLabel('m1', 'bone', '左腕', '  Port Arm ');
    expect(getNameTable('m1').get('bone', '左腕')).toMatchObject({
      ja: '左腕',
      en: 'Port Arm',
      source: 'override',
    });
    expect(useNames.getState().labels[labelKeyFor(info)]).toEqual({ bone: { 左腕: 'Port Arm' } });
    setLabel('m1', 'material', '顔', 'Mug');
    resetLabel('m1', 'bone', '左腕');
    expect(getNameTable('m1').get('bone', '左腕')).toMatchObject({ en: 'Left Arm', source: 'dictionary' });
    expect(getLabels('m1')).toEqual({ bone: {}, material: { 顔: 'Mug' } });
    expect(importLabels('m1', { bone: { 謎: 'Riddle' }, morph: { まばたき: '' } })).toBe(1);
    expect(getNameTable('m1').get('bone', '謎').en).toBe('Riddle');
    resetAllLabels('m1');
    expect(useNames.getState().labels).toEqual({});
    expect(info.bones.map((b) => b.name)).toEqual(['左腕', '謎']);
    expect(info.morphs[0].name).toBe('まばたき');
  });
});

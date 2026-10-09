import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/engine/defaults';
import {
  createEmptyProject,
  exportProjectZip,
  importProjectZip,
  mergeDefaults,
  parseProjectDoc,
  projectBlobIds,
  type ProjectDoc,
} from './project';

function sampleDoc(): ProjectDoc {
  const doc = createEmptyProject('Dance night');
  doc.models.push({
    id: 'm1',
    name: 'Blocky',
    mainPath: 'Blocky/blocky.pmx',
    files: [
      { blobId: 'aaa', path: 'Blocky/blocky.pmx' },
      { blobId: 'bbb', path: 'Blocky/tex/skin.png' },
    ],
    motion: { blobId: 'ccc', path: 'dance.vmd' },
    state: {
      visible: true,
      physics: false,
      transform: { position: [1, 2, 3], rotation: [0, 90, 0], scale: 1.5 },
      materials: [{ visible: false, outline: true, alpha: 0.5 }],
      morphs: { まばたき: 1 },
    },
  });
  doc.audio = { file: { blobId: 'ddd', path: 'song.mp3' }, offsetMs: 120, volume: 0.8 };
  doc.cameraMotion = { blobId: 'eee', path: 'cam.vmd' };
  doc.settings.lighting.dirIntensity = 1.7;
  return doc;
}

describe('project serialization', () => {
  it('round-trips through JSON', () => {
    const doc = sampleDoc();
    const parsed = parseProjectDoc(JSON.parse(JSON.stringify(doc)));
    expect(parsed).toEqual(doc);
  });

  it('fills missing settings with defaults and drops unknown keys', () => {
    const doc = sampleDoc() as unknown as Record<string, unknown>;
    doc.settings = { lighting: { dirIntensity: 2, bogus: true }, postfx: { bloom: 'yes' } };
    const parsed = parseProjectDoc(doc);
    expect(parsed.settings.lighting.dirIntensity).toBe(2);
    expect(parsed.settings.lighting).not.toHaveProperty('bogus');
    expect(parsed.settings.postfx.bloom).toBe(DEFAULT_SETTINGS.postfx.bloom);
    expect(parsed.settings.background).toEqual(DEFAULT_SETTINGS.background);
  });

  it('rejects invalid or future documents', () => {
    expect(() => parseProjectDoc(null)).toThrow();
    expect(() => parseProjectDoc({ version: 99 })).toThrow(/Unsupported/);
  });

  it('skips malformed models instead of failing', () => {
    const parsed = parseProjectDoc({ version: 1, models: [{ name: 'broken' }, sampleDoc().models[0]] });
    expect(parsed.models).toHaveLength(1);
  });

  it('collects referenced blobs', () => {
    expect([...projectBlobIds(sampleDoc())].sort()).toEqual(['aaa', 'bbb', 'ccc', 'ddd', 'eee']);
  });

  it('mergeDefaults keeps types', () => {
    expect(mergeDefaults({ a: 1, b: { c: 'x' } }, { a: '2', b: { c: 'y', d: 1 } })).toEqual({
      a: 1,
      b: { c: 'y' },
    });
  });

  it('exports and imports a .mmdstudio.zip', async () => {
    const doc = sampleDoc();
    const blobs: Record<string, Blob> = {
      aaa: new Blob(['pmx']),
      bbb: new Blob(['png']),
      ccc: new Blob(['vmd']),
      ddd: new Blob(['mp3']),
      eee: new Blob(['cam']),
    };
    const zip = await exportProjectZip(doc, async (id) => blobs[id]);
    const { doc: imported, blobs: restored } = await importProjectZip(zip);
    expect(imported.id).not.toBe(doc.id);
    expect({ ...imported, id: doc.id, updatedAt: doc.updatedAt }).toEqual(doc);
    expect(await restored.get('ddd')!.text()).toBe('mp3');
    expect(restored.size).toBe(5);
  });

  it('refuses to export when an asset is missing', async () => {
    await expect(exportProjectZip(sampleDoc(), async () => undefined)).rejects.toThrow(/Missing asset/);
  });
});

describe('motion editor state in projects', () => {
  it('survives .mmdstudio.zip export / import with its blobs', async () => {
    const doc = sampleDoc();
    doc.motionEditor = {
      models: {
        m1: {
          base: { blobId: 'me-base', path: 'dance_edited_base.vmd' },
          original: { blobId: 'me-orig', path: 'dance_original.vmd' },
          pins: [
            {
              id: 'p1',
              bone: '左足ＩＫ',
              start: 10,
              end: 30,
              blendIn: 3,
              blendOut: 3,
              anchor: { p: [1, 0, 2], r: [0, 0, 0, 1] },
            },
          ],
          name: 'dance.vmd',
        },
      },
      camera: {
        base: { blobId: 'cam-base', path: 'cam_base.vmd' },
        original: { blobId: 'cam-orig', path: 'cam_orig.vmd' },
        name: 'cam.vmd',
      },
      markers: [{ id: 'k1', f: 60, name: 'Chorus' }],
      grid: { bpm: 128, offset: 4, beatsPerBar: 4 },
      shots: [{ id: 's1', name: 'A', start: 0, end: 59, color: '#fff', transition: 'cut' }],
    };
    const ids = projectBlobIds(doc);
    for (const id of ['me-base', 'me-orig', 'cam-base', 'cam-orig']) expect(ids.has(id)).toBe(true);
    const zip = await exportProjectZip(doc, async (id) => new Blob([id]));
    const { doc: imported, blobs } = await importProjectZip(zip);
    expect(imported.motionEditor).toEqual(doc.motionEditor);
    expect(await blobs.get('me-base')!.text()).toBe('me-base');
    expect(await blobs.get('cam-orig')!.text()).toBe('cam-orig');
  });
});

describe('name labels in projects', () => {
  it('survive .mmdstudio.zip export / import and drop malformed entries', async () => {
    const doc = sampleDoc();
    doc.labels = {
      'Blocky#0badf00d': {
        bone: { 左腕: 'Port Arm' },
        morph: { まばたき: 'Close Eyes' },
        material: { 顔: 'Mug' },
      },
    };
    const zip = await exportProjectZip(doc, async (id) => new Blob([id]));
    const { doc: imported } = await importProjectZip(zip);
    expect(imported.labels).toEqual(doc.labels);
    const parsed = parseProjectDoc({
      ...JSON.parse(JSON.stringify(doc)),
      labels: { a: { bone: { 左腕: 'X', 右腕: 3, 頭: '  ' }, morph: 'nope' }, b: null, c: { bone: {} } },
    });
    expect(parsed.labels).toEqual({ a: { bone: { 左腕: 'X' } } });
    expect(parseProjectDoc({ ...JSON.parse(JSON.stringify(doc)), labels: undefined }).labels).toBeUndefined();
  });
});

describe('NPR looks in projects', () => {
  it('survive JSON and .mmdstudio.zip round trips and are cleaned on restore', async () => {
    const { cleanModelLooks, cleanSettings, DEFAULT_NPR_SETTINGS } = await import('./npr/looks');
    const doc = sampleDoc();
    doc.looks = {
      models: {
        m1: {
          seeThroughEyes: false,
          materials: { 髪: { look: 'animeHair', params: { rimStrength: 0.9 } }, 目: { look: 'eye' } },
        },
      },
      settings: { ...DEFAULT_NPR_SETTINGS, tier: 'medium', shadowWarmth: 0.4, outlineMode: 'post' },
    };
    expect(parseProjectDoc(JSON.parse(JSON.stringify(doc))).looks).toEqual(doc.looks);
    const blobs: Record<string, Blob> = Object.fromEntries(
      ['aaa', 'bbb', 'ccc', 'ddd', 'eee'].map((k) => [k, new Blob([k])]),
    );
    const { doc: imported } = await importProjectZip(await exportProjectZip(doc, async (id) => blobs[id]));
    expect(imported.looks).toEqual(doc.looks);
    // Restore validates whatever the file holds.
    expect(cleanModelLooks(imported.looks!.models.m1)).toEqual(doc.looks.models.m1);
    expect(cleanSettings(imported.looks!.settings)).toEqual(doc.looks.settings);
    const tampered = parseProjectDoc({
      ...JSON.parse(JSON.stringify(doc)),
      looks: { models: { m1: { materials: { x: { look: 'evil' } } } } },
    });
    expect(cleanModelLooks(tampered.looks!.models.m1)!.materials).toEqual({});
  });
});

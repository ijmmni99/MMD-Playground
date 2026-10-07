import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/fixtures';
import { expandZips, planImport } from './ingest';
import { unzipBuffer, zipFiles } from './zip';

const unzip = async (b: Blob) => unzipBuffer(await b.arrayBuffer());

describe('import planning', () => {
  it('scopes textures to their model folder and splits camera/model motions', async () => {
    const files = [
      fixture('Blocky/blocky.pmx', 'Blocky/blocky.pmx'),
      fixture('Blocky/tex/skin.png', 'Blocky/tex/skin.png'),
      fixture('Blocky/tex/hair.png', 'Blocky/tex/hair.png'),
      fixture('dance.vmd'),
      fixture('camera.vmd'),
      fixture('beat.wav'),
      { path: 'readme.txt', blob: new Blob(['hi']) },
      { path: 'weird.xyz', blob: new Blob(['?']) },
    ];
    const plan = await planImport(files);
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0].mainPath).toBe('Blocky/blocky.pmx');
    expect(plan.models[0].files.map((f) => f.path).sort()).toEqual([
      'Blocky/blocky.pmx',
      'Blocky/tex/hair.png',
      'Blocky/tex/skin.png',
    ]);
    expect(plan.motions.map((f) => f.path)).toEqual(['dance.vmd']);
    expect(plan.cameraMotions.map((f) => f.path)).toEqual(['camera.vmd']);
    expect(plan.audio.map((f) => f.path)).toEqual(['beat.wav']);
    expect(plan.ignored).toEqual(['weird.xyz']);
  });

  it('expands ZIP packs into a folder named after the archive', async () => {
    const pack = await zipFiles([
      { path: 'model.pmx', data: await fixture('Blocky/blocky.pmx').blob.arrayBuffer() },
      { path: 'tex/skin.png', data: await fixture('Blocky/tex/skin.png').blob.arrayBuffer() },
      { path: 'motion.vmd', data: await fixture('dance.vmd').blob.arrayBuffer() },
    ]);
    const files = await expandZips(
      [{ path: 'downloads/MyPack.zip', blob: pack }, fixture('beat.wav')],
      unzip,
    );
    expect(files.map((f) => f.path).sort()).toEqual([
      'beat.wav',
      'downloads/MyPack/model.pmx',
      'downloads/MyPack/motion.vmd',
      'downloads/MyPack/tex/skin.png',
    ]);
    const plan = await planImport(files);
    expect(plan.models[0].files.map((f) => f.path)).toContain('downloads/MyPack/tex/skin.png');
    expect(plan.motions).toHaveLength(1);
  });

  it('treats project archives separately', async () => {
    const plan = await planImport([{ path: 'show.mmdstudio.zip', blob: new Blob(['x']) }]);
    expect(plan.projects).toHaveLength(1);
  });
});

describe('nested archives', () => {
  it('expands a ZIP inside a ZIP', async () => {
    const inner = await zipFiles([{ path: 'm/model.pmx', data: 'x' }]);
    const outer = await zipFiles([
      { path: 'inner.zip', data: inner },
      { path: 'readme.txt', data: 'hi' },
    ]);
    const files = await expandZips([{ path: 'download.zip', blob: outer }], unzip);
    expect(files.map((f) => f.path).sort()).toEqual(['download/inner/m/model.pmx', 'download/readme.txt']);
  });
});

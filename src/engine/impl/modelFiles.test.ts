import { describe, expect, it } from 'vitest';
import { fixture } from '@/test/fixtures';
import { prepareModelFiles } from './modelFiles';

describe('prepareModelFiles (texture path resolution)', () => {
  it('resolves PMX texture references case-insensitively and across separators', async () => {
    // The fixture references "tex/skin.png" and "Tex\\Hair.PNG".
    const files = [fixture('Blocky/blocky.pmx', 'Pack/Blocky/blocky.pmx'), fixture('Blocky/tex/skin.png', 'Pack/Blocky/tex/skin.png'), fixture('Blocky/tex/hair.png', 'Pack/Blocky/tex/hair.png')];
    const prepared = await prepareModelFiles(files, 'Pack/Blocky/blocky.pmx');
    expect(prepared.rootUrl).toBe('Pack/Blocky/');
    expect(prepared.missing).toEqual([]);
    expect(prepared.remapped).toEqual([]);
    const paths = prepared.referenceFiles.map((f) => f.webkitRelativePath).sort();
    // keys must equal what babylon-mmd computes: rootUrl + normalized reference
    expect(paths).toEqual(['Pack/Blocky/Tex/Hair.PNG', 'Pack/Blocky/tex/skin.png']);
  });

  it('falls back to basename matches and placeholders for missing textures', async () => {
    const files = [fixture('Blocky/blocky.pmx', 'm/blocky.pmx'), fixture('Blocky/tex/hair.png', 'm/textures/other/HAIR.png')];
    const prepared = await prepareModelFiles(files, 'm/blocky.pmx');
    expect(prepared.remapped).toEqual(['Tex\\Hair.PNG']);
    expect(prepared.missing).toEqual(['tex/skin.png']);
    // placeholder injected so the loader does not hit the network
    expect(prepared.referenceFiles.find((f) => f.webkitRelativePath === 'm/tex/skin.png')?.type).toBe('image/png');
  });

  it('throws when the main file is absent', async () => {
    await expect(prepareModelFiles([], 'nope.pmx')).rejects.toThrow(/not found/);
  });
});

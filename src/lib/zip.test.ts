import Encoding from 'encoding-japanese';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { unzipBuffer, zipFiles } from './zip';

describe('zip', () => {
  it('round-trips files', async () => {
    const blob = await zipFiles([
      { path: 'a/b.txt', data: 'hello' },
      { path: '初音/c.bin', data: new Uint8Array([1, 2, 3]).buffer },
    ]);
    const entries = await unzipBuffer(await blob.arrayBuffer());
    expect(entries.map((e) => e.path).sort()).toEqual(['a/b.txt', '初音/c.bin']);
    expect(new TextDecoder().decode(entries.find((e) => e.path === 'a/b.txt')!.data)).toBe('hello');
  });

  it('decodes Shift-JIS file names written without the UTF-8 flag', async () => {
    const zip = new JSZip();
    zip.file('ミク/テクスチャ/顔.png', new Uint8Array([9]));
    zip.file('ミク/model.pmx', new Uint8Array([1]));
    const buf = await zip.generateAsync({
      type: 'arraybuffer',
      // JSZip's typings say string, but its runtime (and docs) accept raw bytes here.
      encodeFileName: ((name: string) =>
        Uint8Array.from(Encoding.convert(Encoding.stringToCode(name), { to: 'SJIS', from: 'UNICODE' }))) as unknown as (name: string) => string,
    });
    const entries = await unzipBuffer(buf);
    expect(entries.map((e) => e.path).sort()).toEqual(['ミク/model.pmx', 'ミク/テクスチャ/顔.png']);
  });

  it('skips macOS metadata entries', async () => {
    const blob = await zipFiles([
      { path: 'm/a.pmx', data: 'x' },
      { path: '__MACOSX/m/._a.pmx', data: 'junk' },
      { path: 'm/.DS_Store', data: 'junk' },
    ]);
    const entries = await unzipBuffer(await blob.arrayBuffer());
    expect(entries.map((e) => e.path)).toEqual(['m/a.pmx']);
  });
});

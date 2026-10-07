import Encoding from 'encoding-japanese';
import { describe, expect, it } from 'vitest';
import { basename, classify, dirname, extname, joinPath, normalizePath, PathResolver } from './paths';
import { decodeZipName } from './zipNames';

describe('normalizePath', () => {
  it('converts backslashes and resolves dot segments', () => {
    expect(normalizePath('Model\\tex\\..\\face.png')).toBe('Model/face.png');
    expect(normalizePath('./a//b/./c.png')).toBe('a/b/c.png');
    expect(normalizePath('/abs/path')).toBe('abs/path');
  });
  it('splits names', () => {
    expect(dirname('a/b/c.pmx')).toBe('a/b');
    expect(dirname('c.pmx')).toBe('');
    expect(basename('a\\b\\c.PMX')).toBe('c.PMX');
    expect(extname('a/b/c.PMX')).toBe('pmx');
    expect(extname('.hidden')).toBe('');
    expect(joinPath('a/b', '../tex/x.png')).toBe('a/tex/x.png');
  });
});

describe('PathResolver', () => {
  const files = [
    { path: 'Miku/Miku.pmx' },
    { path: 'Miku/tex/Face.png' },
    { path: 'Miku/tex/hair.PNG' },
    { path: 'Miku/spa/metal.spa' },
    { path: 'Other/stray.bmp' },
  ];
  const r = new PathResolver(files);

  it('resolves exact paths case-insensitively with any separator', () => {
    expect(r.resolve('tex\\face.png', 'Miku')).toEqual({ file: files[1], via: 'exact' });
    expect(r.resolve('TEX/HAIR.png', 'Miku')).toEqual({ file: files[2], via: 'exact' });
  });
  it('falls back to a unique basename match', () => {
    expect(r.resolve('textures/metal.spa', 'Miku')).toEqual({ file: files[3], via: 'basename' });
    expect(r.resolve('stray.bmp', 'Miku')).toEqual({ file: files[4], via: 'basename' });
  });
  it('reports missing files', () => {
    expect(r.resolve('tex/nothere.png', 'Miku')).toEqual({ file: undefined, via: 'missing' });
  });
  it('matches NFD (macOS) and NFC forms of Japanese names', () => {
    const nfd = 'モデル/テクスチャ.png'.normalize('NFD');
    const rr = new PathResolver([{ path: nfd }]);
    expect(rr.resolve('テクスチャ.png'.normalize('NFC'), 'モデル').via).toBe('exact');
  });
});

describe('decodeZipName', () => {
  it('passes ASCII through', () => {
    expect(decodeZipName(new TextEncoder().encode('model/a.pmx'))).toBe('model/a.pmx');
  });
  it('decodes UTF-8', () => {
    expect(decodeZipName(new TextEncoder().encode('初音ミク/顔.png'))).toBe('初音ミク/顔.png');
  });
  it('decodes Shift-JIS', () => {
    const sjis = Uint8Array.from(
      Encoding.convert(Encoding.stringToCode('初音ミク/テクスチャ/顔.png'), { to: 'SJIS', from: 'UNICODE' }),
    );
    expect(decodeZipName(sjis)).toBe('初音ミク/テクスチャ/顔.png');
  });
});

describe('classify', () => {
  it('classifies asset kinds', () => {
    expect(classify('a.PMX')).toBe('model');
    expect(classify('a.vmd')).toBe('motion');
    expect(classify('song.mp3')).toBe('audio');
    expect(classify('pack.zip')).toBe('zip');
    expect(classify('my.mmdstudio.zip')).toBe('project');
    expect(classify('sky.hdr')).toBe('hdr');
    expect(classify('t.spa')).toBe('texture');
    expect(classify('x.pose.json')).toBe('pose');
    expect(classify('readme.txt')).toBe('other');
  });
});

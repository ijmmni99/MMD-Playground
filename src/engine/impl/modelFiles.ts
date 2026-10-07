import { PmdReader } from 'babylon-mmd/esm/Loader/Parser/pmdReader';
import { PmxReader } from 'babylon-mmd/esm/Loader/Parser/pmxReader';
import { basename, dirname, extname, joinPath, normalizePath, PathResolver } from '@/lib/paths';
import type { VFile } from '../types';

// 1x1 white PNG used when a referenced texture can't be found.
const PLACEHOLDER_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const SHARED_TOON = /^toon(0[0-9]|10)\.bmp$/i;
const BROWSER_IMAGE = /\.(png|jpe?g|bmp|gif|webp|sph|spa)$/i;

export interface PreparedModelFiles {
  main: File;
  rootUrl: string;
  referenceFiles: File[];
  missing: string[];
  remapped: string[];
}

function withRelativePath(blob: Blob, path: string): File {
  const file = new File([blob], basename(path), { type: blob.type });
  Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
  return file;
}

/** Collect every texture path a PMX/PMD references. */
async function readTexturePaths(buffer: ArrayBuffer, ext: string): Promise<string[]> {
  const silent = { log: () => undefined, warn: () => undefined, error: () => undefined };
  if (ext === 'pmd') {
    const obj = await PmdReader.ParseAsync(buffer, silent);
    const set = new Set<string>();
    for (const t of obj.textures) for (const part of t.split('*')) if (part) set.add(part);
    return [...set];
  }
  const obj = await PmxReader.ParseAsync(buffer, silent);
  return [...obj.textures];
}

/**
 * Builds the File list handed to babylon-mmd's reference file resolver. Each referenced texture
 * is given a `webkitRelativePath` that exactly matches the lookup key the loader will compute,
 * so case differences, backslashes, NFC/NFD and misplaced files (basename fallback) all resolve.
 */
export async function prepareModelFiles(files: VFile[], mainPath: string): Promise<PreparedModelFiles> {
  const mainVf = files.find((f) => f.path === mainPath);
  if (!mainVf) throw new Error(`Model file not found: ${mainPath}`);
  const ext = extname(mainPath);
  const modelDir = dirname(mainPath);
  const main = new File([mainVf.blob], basename(mainPath));
  if (ext === 'bpmx') return { main, rootUrl: '', referenceFiles: [], missing: [], remapped: [] };

  const buffer = await mainVf.blob.arrayBuffer();
  const refs = await readTexturePaths(buffer, ext);
  const resolver = new PathResolver(files);
  const referenceFiles: File[] = [];
  const missing: string[] = [];
  const remapped: string[] = [];
  for (const ref of refs) {
    const lookup = joinPath(modelDir, normalizePath(ref));
    const result = resolver.resolve(ref, modelDir);
    if (result.file) {
      if (result.via === 'basename') remapped.push(ref);
      referenceFiles.push(withRelativePath(result.file.blob, lookup));
    } else if (!SHARED_TOON.test(basename(ref))) {
      missing.push(ref);
      // Browser-decoded formats sniff content, so a PNG placeholder works under their extension.
      if (BROWSER_IMAGE.test(ref)) {
        referenceFiles.push(withRelativePath(new Blob([PLACEHOLDER_PNG], { type: 'image/png' }), lookup));
      }
    }
  }
  return { main, rootUrl: modelDir ? modelDir + '/' : '', referenceFiles, missing, remapped };
}

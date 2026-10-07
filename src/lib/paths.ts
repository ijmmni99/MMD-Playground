/** Normalise a path: backslashes to slashes, resolve "." and "..", strip leading "./" and "/". */
export function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

export function dirname(path: string): string {
  const n = normalizePath(path);
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : n.slice(0, i);
}

export function basename(path: string): string {
  const n = normalizePath(path);
  return n.slice(n.lastIndexOf('/') + 1);
}

export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

/** Unicode-normalise and lower-case a path for loose matching. */
export function pathKey(path: string): string {
  return normalizePath(path).normalize('NFC').toLowerCase();
}

export interface ResolveResult<T> {
  file: T | undefined;
  /** How the file was found. */
  via: 'exact' | 'basename' | 'missing';
}

/**
 * Resolves texture references (as written inside a PMX, relative to the model's directory)
 * against a list of files. Matching is case-insensitive, separator-agnostic and falls back to a
 * unique basename match anywhere below the model directory (or anywhere at all).
 */
export class PathResolver<T extends { path: string }> {
  private readonly byKey = new Map<string, T>();
  private readonly byBase = new Map<string, T[]>();

  constructor(files: readonly T[]) {
    for (const f of files) {
      this.byKey.set(pathKey(f.path), f);
      const b = pathKey(basename(f.path));
      const list = this.byBase.get(b);
      if (list) list.push(f);
      else this.byBase.set(b, [f]);
    }
  }

  resolve(reference: string, baseDir: string): ResolveResult<T> {
    const exact = this.byKey.get(pathKey(joinPath(baseDir, reference)));
    if (exact) return { file: exact, via: 'exact' };
    const candidates = this.byBase.get(pathKey(basename(reference)));
    if (candidates && candidates.length > 0) {
      const dirKey = pathKey(baseDir);
      const inside = candidates.filter((c) => dirKey === '' || pathKey(c.path).startsWith(dirKey + '/'));
      const pick = inside[0] ?? candidates[0];
      return { file: pick, via: 'basename' };
    }
    return { file: undefined, via: 'missing' };
  }
}

export type AssetKind = 'model' | 'motion' | 'audio' | 'texture' | 'zip' | 'hdr' | 'project' | 'pose' | 'other';

export function classify(path: string): AssetKind {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mmdstudio.zip')) return 'project';
  const ext = extname(path);
  switch (ext) {
    case 'pmx':
    case 'pmd':
    case 'bpmx':
      return 'model';
    case 'vmd':
      return 'motion';
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'aac':
    case 'flac':
      return 'audio';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'bmp':
    case 'tga':
    case 'dds':
    case 'gif':
    case 'webp':
    case 'sph':
    case 'spa':
      return 'texture';
    case 'zip':
      return 'zip';
    case 'hdr':
    case 'env':
      return 'hdr';
    case 'json':
      return lower.endsWith('.pose.json') ? 'pose' : 'other';
    default:
      return 'other';
  }
}

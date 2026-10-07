import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VFile } from '@/engine/types';

const root = resolve(__dirname, '../../e2e/fixtures');

export function fixture(path: string, as = path): VFile {
  const buf = readFileSync(resolve(root, path));
  return { path: as, blob: new Blob([new Uint8Array(buf)]) };
}

export function fixtureBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(resolve(root, path));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

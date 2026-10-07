import type { VFile } from '@/engine/types';
import { getBlob, hashBlob, putBlob } from './db';
import type { FileRef } from './project';

/** In-memory cache in front of the IndexedDB blob store. */
const cache = new Map<string, Blob>();

/** Store a file (deduplicated by content) and return a reference to it. */
export async function registerFile(file: VFile): Promise<FileRef> {
  const blobId = await hashBlob(file.blob);
  cache.set(blobId, file.blob);
  try {
    await putBlob(blobId, file.blob);
  } catch (err) {
    console.warn('Could not persist asset', file.path, err);
  }
  return { blobId, path: file.path };
}

export async function registerFiles(files: VFile[]): Promise<FileRef[]> {
  const out: FileRef[] = [];
  for (const f of files) out.push(await registerFile(f));
  return out;
}

export async function getAsset(blobId: string): Promise<Blob | undefined> {
  const hit = cache.get(blobId);
  if (hit) return hit;
  const blob = await getBlob(blobId);
  if (blob) cache.set(blobId, blob);
  return blob;
}

export async function resolveRef(ref: FileRef): Promise<VFile> {
  const blob = await getAsset(ref.blobId);
  if (!blob) throw new Error(`Asset missing from storage: ${ref.path}`);
  return { path: ref.path, blob };
}

export async function resolveRefs(refs: FileRef[]): Promise<VFile[]> {
  return Promise.all(refs.map(resolveRef));
}

export function cacheBlob(blobId: string, blob: Blob): void {
  cache.set(blobId, blob);
}

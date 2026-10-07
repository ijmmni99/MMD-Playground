import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { projectBlobIds, summarize, type ProjectDoc, type ProjectSummary } from './project';

interface StudioDB extends DBSchema {
  projects: { key: string; value: ProjectDoc; indexes: { updatedAt: number } };
  blobs: { key: string; value: { id: string; blob: Blob; size: number } };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'mmd-studio';
let dbPromise: Promise<IDBPDatabase<StudioDB>> | null = null;

export function db(): Promise<IDBPDatabase<StudioDB>> {
  dbPromise ??= openDB<StudioDB>(DB_NAME, 1, {
    upgrade(d) {
      const projects = d.createObjectStore('projects', { keyPath: 'id' });
      projects.createIndex('updatedAt', 'updatedAt');
      d.createObjectStore('blobs', { keyPath: 'id' });
      d.createObjectStore('meta');
    },
  });
  return dbPromise;
}

/** For tests: drop the cached connection. */
export function resetDbConnection(): void {
  void dbPromise?.then((d) => d.close());
  dbPromise = null;
}

/** Content hash used as blob id, so identical files are stored once. */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 40);
  }
  // Fallback (non-secure contexts): FNV-1a over the bytes plus size.
  let h = 0x811c9dc5;
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return `f${(h >>> 0).toString(16)}${bytes.length.toString(16)}`;
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  const d = await db();
  const existing = await d.getKey('blobs', id);
  if (existing === undefined) await d.put('blobs', { id, blob, size: blob.size });
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return (await (await db()).get('blobs', id))?.blob;
}

export async function saveProject(doc: ProjectDoc): Promise<void> {
  await (await db()).put('projects', doc);
}

export async function loadProject(id: string): Promise<ProjectDoc | undefined> {
  return (await db()).get('projects', id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await (await db()).getAllFromIndex('projects', 'updatedAt');
  return all.reverse().map(summarize);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  await d.delete('projects', id);
  await collectGarbage();
}

/** Remove blobs no project references any more. */
export async function collectGarbage(): Promise<number> {
  const d = await db();
  const used = new Set<string>();
  for (const p of await d.getAll('projects')) for (const id of projectBlobIds(p)) used.add(id);
  let removed = 0;
  for (const id of await d.getAllKeys('blobs')) {
    if (!used.has(id)) {
      await d.delete('blobs', id);
      removed++;
    }
  }
  return removed;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

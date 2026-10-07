import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createEmptyProject } from './project';
import { collectGarbage, deleteProject, getBlob, getMeta, hashBlob, listProjects, loadProject, putBlob, resetDbConnection, saveProject, setMeta } from './db';

beforeEach(() => {
  resetDbConnection();
  globalThis.indexedDB = new IDBFactory();
});

describe('IndexedDB persistence', () => {
  it('hashes content deterministically', async () => {
    const a = await hashBlob(new Blob(['same']));
    const b = await hashBlob(new Blob(['same']));
    const c = await hashBlob(new Blob(['different']));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('stores projects and lists them newest first', async () => {
    const p1 = { ...createEmptyProject('one'), updatedAt: 1 };
    const p2 = { ...createEmptyProject('two'), updatedAt: 2 };
    await saveProject(p1);
    await saveProject(p2);
    expect((await listProjects()).map((p) => p.name)).toEqual(['two', 'one']);
    expect((await loadProject(p1.id))?.name).toBe('one');
  });

  it('stores blobs and garbage-collects unreferenced ones', async () => {
    await putBlob('keep', new Blob(['k']));
    await putBlob('drop', new Blob(['d']));
    const p = createEmptyProject();
    p.cameraMotion = { blobId: 'keep', path: 'cam.vmd' };
    await saveProject(p);
    expect(await collectGarbage()).toBe(1);
    expect(await getBlob('keep')).toBeDefined();
    expect(await getBlob('drop')).toBeUndefined();
    await deleteProject(p.id);
    expect(await getBlob('keep')).toBeUndefined();
  });

  it('stores meta values', async () => {
    await setMeta('lastProjectId', 'abc');
    expect(await getMeta('lastProjectId')).toBe('abc');
  });
});

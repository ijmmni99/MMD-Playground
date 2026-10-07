import { openDB } from 'idb';
import type { VFile } from '@/engine/types';
import { importFiles } from '@/store/actions';

/**
 * Files shared to the installed app (Android "Share → MMD Studio") are stored by the service
 * worker in this IndexedDB inbox, then imported once the app has started.
 */
export const SHARE_DB = 'mmd-share-inbox';
export const SHARE_STORE = 'files';

export async function consumeShareInbox(): Promise<void> {
  if (typeof indexedDB === 'undefined' || !new URLSearchParams(location.search).has('shared')) return;
  const db = await openDB(SHARE_DB, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(SHARE_STORE))
        d.createObjectStore(SHARE_STORE, { autoIncrement: true });
    },
  });
  const entries = (await db.getAll(SHARE_STORE)) as { name: string; blob: Blob }[];
  await db.clear(SHARE_STORE);
  db.close();
  history.replaceState(null, '', location.pathname);
  const files: VFile[] = entries.map((e) => ({ path: e.name, blob: e.blob }));
  if (files.length) await importFiles(files);
}

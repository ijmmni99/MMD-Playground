/// <reference lib="webworker" />
// Service worker: precaches the app shell (incl. Bullet physics WASM) for offline use and
// handles the Android Web Share Target. User projects are never cached here — they live in
// IndexedDB and are loaded through blob: URLs, which the service worker never sees.
import { openDB } from 'idb';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
};

const SHARE_DB = 'mmd-share-inbox';
const SHARE_STORE = 'files';

// Share target first, so it answers POSTs before Workbox's routes look at the request.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll('files').filter((f): f is File => f instanceof File);
        const db = await openDB(SHARE_DB, 1, {
          upgrade(d) {
            if (!d.objectStoreNames.contains(SHARE_STORE))
              d.createObjectStore(SHARE_STORE, { autoIncrement: true });
          },
        });
        for (const f of files) await db.add(SHARE_STORE, { name: f.name, blob: f });
        db.close();
      } catch {
        /* fall through to the app; it will just open normally */
      }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })(),
  );
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Lazily loaded chunks not in the precache (e.g. the Monaco editor) are cached on first use.
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin && url.pathname.includes('/assets/') && request.method === 'GET',
  new StaleWhileRevalidate({ cacheName: 'mmd-assets', plugins: [new ExpirationPlugin({ maxEntries: 80 })] }),
);
// The built-in sample (procedurally generated, public domain) is fine to cache.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.includes('/sample/'),
  new CacheFirst({ cacheName: 'mmd-sample', plugins: [new ExpirationPlugin({ maxEntries: 20 })] }),
);

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

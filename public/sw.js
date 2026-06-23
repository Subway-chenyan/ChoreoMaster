const LEGACY_CACHE_PREFIXES = ['choreomaster-', 'cosstage-'];

const clearLegacyCaches = async () => {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .map((key) => caches.delete(key)),
  );
};

self.addEventListener('install', (event) => {
  event.waitUntil(clearLegacyCaches());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await clearLegacyCaches();
      await self.clients.claim();
      await self.registration.unregister();
    })(),
  );
});

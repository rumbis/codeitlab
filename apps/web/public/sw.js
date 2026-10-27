/*
 * CodeItLab service worker.
 *
 * Served from public/ exactly as written: no build step, no imports, no
 * dependencies. Registration lives in src/pwa/registerServiceWorker.ts, which
 * only runs in a secure production context (or with ?sw=1) and never in
 * Electron.
 *
 * Strategy:
 * - navigations: network-first, falling back to the cached offline page
 * - static assets: stale-while-revalidate
 * - API, websocket, auth and every non-GET request: never intercepted
 */
const CACHE_VERSION = "v1";
const CACHE_PREFIX = "codeitlab-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  "/",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
];

// Prefixes owned by the server or the auth flow. A cached /api response would
// leak state across users, and a cached websocket upgrade is meaningless.
const BYPASS_PATHS = ["/api", "/ws", "/oauth", "/.well-known", "/__codeitlab"];

const STATIC_ASSET_PATTERN =
  /\.(?:css|js|mjs|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|wasm|webmanifest)$/i;
const STATIC_DESTINATIONS = new Set(["script", "style", "image", "font", "manifest", "worker"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One missing optional asset must not fail the whole install, otherwise a
      // partial deploy would leave the app without an offline shell.
      await Promise.all(PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== ASSET_CACHE,
          )
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isBypassedPath(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(request, url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

function isBypassedPath(pathname) {
  return BYPASS_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isStaticAsset(request, pathname) {
  return STATIC_ASSET_PATTERN.test(pathname) || STATIC_DESTINATIONS.has(request.destination);
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("CodeItLab is offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

function staleWhileRevalidate(event, request) {
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === "basic") {
      void caches.open(ASSET_CACHE).then((cache) => cache.put(request, response.clone()));
    }
    return response;
  });

  // Keep the worker alive for the background refresh even when the cached copy
  // answers immediately, so the next load sees the new asset.
  event.waitUntil(network.catch(() => undefined));

  return caches.open(ASSET_CACHE).then(async (cache) => {
    const cached = await cache.match(request);
    return cached ?? network.catch(() => Response.error());
  });
}

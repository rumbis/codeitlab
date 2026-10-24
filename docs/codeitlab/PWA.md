# Installing CodeitLab as an app (PWA)

CodeitLab ships as a progressive web app. There is no store build to wait for:
open `https://app.codeitlab.com` in the browser and install it. The installed app
gets its own icon and window, remembers your server, and keeps a small offline
shell so a dead connection shows a branded "you are offline" page instead of a
browser error.

## Android

Chrome or Edge: open `https://app.codeitlab.com`, then **Install app** in the
browser menu (or the install banner the app shows). Chromium fires
`beforeinstallprompt`, so the banner can trigger the native prompt directly.

## iPhone and iPad

Safari: open `https://app.codeitlab.com`, tap **Share**, then **Add to Home
Screen**. iOS does not fire `beforeinstallprompt`; the app's banner shows these
steps instead. Other iOS browsers and in-app webviews may not offer Add to Home
Screen — open the site in Safari for the install.

## Desktop

Chrome, Edge and Brave can install the same URL as a windowed app. On macOS,
`https://app.codeitlab.com` installed from Chrome gives a standalone window next
to the Electron build; both talk to the same server.

## Connect the phone to your computer

The installed app is a client; it still needs your CodeitLab server. The easiest
path that works on any network is a Cloudflare Tunnel:

1. On the computer, open **Settings → CodeitLab → Remote**, install
   `cloudflared` if the page asks for it, then **Cloudflare Tunnel → Start
   tunnel**. Cloudflare gives the server a public HTTPS URL without touching
   your router.
2. Press **Create phone link**. Two links appear: the **PWA link** (for the
   installed app) and a direct link (for a browser or the native app). Scan the
   QR with the phone's camera, or copy the PWA link and open it on the phone.
3. The hosted app pairs with your server and saves it. Open the installed app
   and the environment is there. No account is created.

Quick-tunnel URLs are temporary: if the phone stops connecting, press **Refresh
URL** on the Remote page and use a fresh link. A named Cloudflare tunnel gives
you a stable hostname if you want the pairing to survive restarts.

## What works offline

The service worker precaches the app shell, manifest and icons, serves
navigations network-first with the offline page as fallback, and caches static
assets stale-while-revalidate. It never caches `/api`, `/ws`, `/oauth`,
`/.well-known`, non-GET requests, or anything auth-related, so nothing sensitive
lands in a cache and the app never shows stale server state.

## Dev notes

- Registration is skipped in Electron and in non-secure contexts, and in dev it
  is opt-in: open `http://localhost:<port>/?sw=1` to test the worker (localhost
  counts as a secure context). Production registers automatically.
- The worker lives at `apps/web/public/sw.js` and is served from `/sw.js`; bump
  the cache version in that file when changing precached URLs.
- Icons: `apps/web/public/icons/icon-192.png`, `icon-512.png` and
  `icon-512-maskable.png` (maskable art stays inside the 80% safe zone), plus
  `apple-touch-icon.png`.
- The install banner is dismissible and the dismissal is remembered in
  `localStorage`; it hides itself when the app is already running standalone.

## Deploying

Serve the built web app at `https://app.codeitlab.com` with HTTPS (service
workers require it) and make sure `/sw.js` and `/manifest.webmanifest` are served
from the origin root, not under a path prefix. The manifest's `start_url` and
`scope` are `/`.

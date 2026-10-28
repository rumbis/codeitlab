import type { AppContext } from "./context.ts";
import { pageUrl } from "../pages/layout.ts";
import { layout } from "../pages/layout.ts";

/**
 * The marketplace is installable because a coder checking a delivery on a phone
 * should not have to find the site again. The service worker caches only static
 * assets and one offline page: no HTML that carries an account is ever cached,
 * and every request that could move money stays network-only.
 */
export const PWA_THEME_COLOR = "#0b0d12";
export const PWA_CACHE_NAME = "codeitlab-market-v1";

export function renderManifest(ctx: AppContext): string {
  return JSON.stringify(
    {
      name: "CodeItLab Marketplace",
      short_name: "CodeItLab",
      description:
        "Hire vetted vibe coders, or get paid for work you already know how to do. Money stays in escrow until the work is approved.",
      start_url: pageUrl(ctx.basePath, "/"),
      scope: pageUrl(ctx.basePath, "/"),
      id: pageUrl(ctx.basePath, "/"),
      display: "standalone",
      display_override: ["window-controls-overlay", "standalone"],
      orientation: "any",
      background_color: PWA_THEME_COLOR,
      theme_color: PWA_THEME_COLOR,
      categories: ["business", "productivity"],
      icons: [
        {
          src: pageUrl(ctx.basePath, "/icon.svg"),
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
      ],
      shortcuts: [
        {
          name: "Open jobs",
          short_name: "Jobs",
          description: "Browse work with a budget and a timeline",
          url: pageUrl(ctx.basePath, "/jobs"),
          icons: [{ src: pageUrl(ctx.basePath, "/icon.svg"), sizes: "any", type: "image/svg+xml" }],
        },
        {
          name: "My dashboard",
          short_name: "Dashboard",
          description: "Engagements, deliveries and what needs you",
          url: pageUrl(ctx.basePath, "/dashboard"),
          icons: [{ src: pageUrl(ctx.basePath, "/icon.svg"), sizes: "any", type: "image/svg+xml" }],
        },
        {
          name: "Public numbers",
          short_name: "Numbers",
          description: "Every figure computed from the ledger",
          url: pageUrl(ctx.basePath, "/numbers"),
          icons: [{ src: pageUrl(ctx.basePath, "/icon.svg"), sizes: "any", type: "image/svg+xml" }],
        },
      ],
    },
    null,
    2,
  );
}

export const PWA_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="CodeItLab">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6ee7ff"/>
      <stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="${PWA_THEME_COLOR}"/>
  <path d="M330 168a112 112 0 1 0 0 176" fill="none" stroke="url(#g)" stroke-width="56" stroke-linecap="round"/>
  <circle cx="366" cy="256" r="26" fill="url(#g)"/>
</svg>
`;

export function renderAppScript(ctx: AppContext): string {
  return `(function () {
  var base = ${JSON.stringify(ctx.basePath)};
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register(base + "/sw.js").catch(function () {});
  });

  function b64urlToBytes(value) {
    var padded = value.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    var raw = atob(padded);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function bytesToB64url(buffer) {
    var bytes = new Uint8Array(buffer);
    var text = "";
    for (var i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
    return btoa(text).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }

  function setPushStatus(text) {
    var element = document.getElementById("push-status");
    if (element) element.textContent = text;
  }

  function saveSubscription(subscription) {
    return fetch(base + "/api/push/subscribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: bytesToB64url(subscription.getKey("p256dh")),
          auth: bytesToB64url(subscription.getKey("auth")),
        },
      }),
    }).then(function (response) {
      if (!response.ok) throw new Error("Could not save this device.");
      return subscription;
    });
  }

  function enablePush(button) {
    if (!("Notification" in window) || !("PushManager" in window)) {
      setPushStatus("This browser does not support push notifications.");
      return;
    }
    button.disabled = true;
    setPushStatus("Asking the browser…");
    fetch(base + "/api/push/key", { credentials: "same-origin" })
      .then(function (response) { return response.json(); })
      .then(function (config) {
        if (!config.enabled) throw new Error("Push is not configured on this server.");
        return Notification.requestPermission().then(function (permission) {
          if (permission !== "granted") throw new Error("Notifications were not allowed.");
          return navigator.serviceWorker.ready;
        }).then(function (registration) {
          return registration.pushManager.getSubscription().then(function (existing) {
            if (existing) return existing;
            return registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: b64urlToBytes(config.publicKey),
            });
          });
        });
      })
      .then(saveSubscription)
      .then(function () {
        button.textContent = "Turn off notifications";
        button.dataset.on = "1";
        button.disabled = false;
        setPushStatus("Notifications are on for this device.");
      })
      .catch(function (error) {
        button.disabled = false;
        setPushStatus((error && error.message) || "Could not enable notifications.");
      });
  }

  function disablePush(button) {
    button.disabled = true;
    navigator.serviceWorker.ready
      .then(function (registration) { return registration.pushManager.getSubscription(); })
      .then(function (subscription) {
        if (!subscription) return null;
        var endpoint = subscription.endpoint;
        return subscription.unsubscribe().then(function () {
          return fetch(base + "/api/push/unsubscribe", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: endpoint }),
          });
        });
      })
      .then(function () {
        button.textContent = "Enable notifications";
        delete button.dataset.on;
        button.disabled = false;
        setPushStatus("Notifications are off for this device.");
      })
      .catch(function () {
        button.disabled = false;
        setPushStatus("Could not turn notifications off.");
      });
  }

  var pushButton = document.getElementById("enable-push");
  if (pushButton) {
    pushButton.addEventListener("click", function () {
      if (pushButton.dataset.on === "1") disablePush(pushButton);
      else enablePush(pushButton);
    });
    if ("Notification" in window && "PushManager" in window) {
      navigator.serviceWorker.ready
        .then(function (registration) { return registration.pushManager.getSubscription(); })
        .then(function (subscription) {
          if (!subscription) return;
          pushButton.textContent = "Turn off notifications";
          pushButton.dataset.on = "1";
          setPushStatus("Notifications are on for this device.");
        })
        .catch(function () {});
    }
  }
})();
`;
}

export function renderServiceWorker(ctx: AppContext): string {
  const base = JSON.stringify(ctx.basePath);
  const precache = [
    `${ctx.basePath}/styles.css`,
    `${ctx.basePath}/icon.svg`,
    `${ctx.basePath}/offline`,
  ]
    .map((path) => JSON.stringify(path))
    .join(", ");
  return `const CACHE = ${JSON.stringify(PWA_CACHE_NAME)};
const BASE = ${base};
const PRECACHE = [${precache}];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Web Push: the payload arrives encrypted (aes128gcm) and is decrypted by the
// browser before this handler runs, so the push service only saw ciphertext.
self.addEventListener("push", (event) => {
  let message = { title: "CodeItLab", body: "Something happened on your dashboard.", href: BASE + "/dashboard" };
  try {
    if (event.data) message = Object.assign(message, event.data.json());
  } catch {
    // A malformed payload still shows a notification instead of failing silently.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: BASE + "/icon.svg",
      badge: BASE + "/icon.svg",
      data: { href: message.href },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || BASE + "/dashboard";
  const target = new URL(href, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Money moves over POST; the worker never sees, caches or replays it.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations are network-first so a page is never a stale copy of someone
  // else's account; offline falls back to one static page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(BASE + "/offline").then(
          (cached) =>
            cached ??
            new Response("Offline", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            }),
        ),
      ),
    );
    return;
  }

  if (
    url.pathname === BASE + "/styles.css" ||
    url.pathname === BASE + "/icon.svg" ||
    url.pathname === BASE + "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
  }
});
`;
}

export function renderOfflinePage(ctx: AppContext): string {
  return layout({
    basePath: ctx.basePath,
    title: "Offline",
    account: null,
    description: "You are offline. The marketplace will reconnect when you are back.",
    content: `<section class="stack">
      <p class="eyebrow">No connection</p>
      <h1>You are offline</h1>
      <p class="lead">Nothing was lost. Escrow and approvals only happen on the server, so this page never shows a stale balance or a button that cannot work.</p>
      <p>When the connection returns, <a class="link" href="${pageUrl(ctx.basePath, "/dashboard")}">open your dashboard</a> to see what needs you.</p>
    </section>`,
  });
}

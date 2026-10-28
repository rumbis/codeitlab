import { afterEach, describe, expect, it } from "vite-plus/test";

import { createTestApp, type TestApp } from "./helpers.ts";

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp(overrides);
  apps.push(app);
  return app;
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  icons: { src: string; type: string; sizes: string }[];
}

describe("marketplace PWA", () => {
  it("serves an installable manifest with the right scope", async () => {
    const app = newApp();
    const response = await app.request("/manifest.webmanifest");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    const manifest = (await response.json()) as Manifest;
    expect(manifest.name).toBe("CodeItLab Marketplace");
    expect(manifest.short_name).toBe("CodeItLab");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons[0]?.src).toBe("/icon.svg");
    expect(manifest.icons[0]?.type).toBe("image/svg+xml");
  });

  it("keeps every generated URL under a mounted base path", async () => {
    const app = newApp({ basePath: "/market" });
    const manifest = (await (await app.request("/market/manifest.webmanifest")).json()) as Manifest;
    expect(manifest.start_url).toBe("/market/");
    expect(manifest.scope).toBe("/market/");
    expect(manifest.icons[0]?.src).toBe("/market/icon.svg");

    const appJs = await (await app.request("/market/app.js")).text();
    expect(appJs).toContain('var base = "/market"');
    expect(appJs).toContain('"/sw.js"');

    const worker = await (await app.request("/market/sw.js")).text();
    expect(worker).toContain('"/market/styles.css"');
    expect(worker).toContain('"/market/offline"');
    expect(worker).toContain('const BASE = "/market"');
  });

  it("serves the icon and registers the worker from a same-origin script", async () => {
    const app = newApp();
    const icon = await app.request("/icon.svg");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/svg+xml");
    expect(await icon.text()).toContain("<svg");

    const appJs = await app.request("/app.js");
    expect(appJs.status).toBe(200);
    expect(appJs.headers.get("content-type")).toContain("text/javascript");
    const script = await appJs.text();
    expect(script).toContain("serviceWorker.register");
    expect(script).toContain('"/sw.js"');

    const home = await (await app.request("/")).text();
    expect(home).toContain('rel="manifest"');
    expect(home).toContain('src="/app.js"');
    expect(home).toContain('rel="icon"');
  });

  it("caches only static assets, never HTML or API responses", async () => {
    const app = newApp();
    const response = await app.request("/sw.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const worker = await response.text();

    expect(worker).toContain("codeitlab-market-v1");
    expect(worker).toContain("/styles.css");
    expect(worker).toContain("/icon.svg");
    expect(worker).toContain("/offline");
    // POSTs move money; the worker must not intercept them.
    expect(worker).toContain('request.method !== "GET"');
    // API responses carry account data and are never cached or replayed.
    expect(worker).not.toContain("/api/");
    // Navigations stay network-first.
    expect(worker).toContain('request.mode === "navigate"');
  });

  it("offers an offline page that promises nothing it cannot keep", async () => {
    const app = newApp();
    const response = await app.request("/offline");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("You are offline");
    expect(html).toContain("stale balance");
    expect(html).toContain("/dashboard");
  });

  it("keeps the strict CSP and requires no session", async () => {
    const app = newApp();
    const manifest = await app.request("/manifest.webmanifest");
    expect(manifest.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(manifest.headers.get("x-frame-options")).toBe("DENY");
    expect((await app.request("/offline")).status).toBe(200);
    expect((await app.request("/sw.js")).status).toBe(200);
  });
});

describe("installable app script", () => {
  it("serves app.js that parses in a browser and keeps the base64url escapes", async () => {
    const app = newApp({ basePath: "/market" });
    const response = await app.request("/app.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const script = await response.text();
    // The service worker registration and push subscription live in this file:
    // one bad escape means the whole script fails to parse in the browser.
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('replace(/\\+/g, "-")');
    expect(script).toContain('replace(/\\//g, "_")');
    expect(script).toContain('register(base + "/sw.js")');
  });
});

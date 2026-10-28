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

describe("well-known files", () => {
  it("serves an RFC 9116 security.txt with a future expiry and absolute canonical", async () => {
    const app = newApp({ basePath: "/market", baseUrl: "https://codeitlab.com/market" });
    const response = await app.request("/market/.well-known/security.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toMatch(/^Contact: mailto:security@codeitlab\.com$/mu);
    expect(text).toContain("Preferred-Languages: en, el");
    expect(text).toContain("Canonical: https://codeitlab.com/market/.well-known/security.txt");
    const expires = /Expires: (\d{4}-\d{2}-\d{2})/u.exec(text)?.[1];
    expect(expires).toBeDefined();
    expect(new Date(`${expires}T00:00:00Z`).getTime()).toBeGreaterThan(app.now().getTime());
  });

  it("keeps crawlers out of admin, api, dashboard and login", async () => {
    const app = newApp({ basePath: "/market" });
    const response = await app.request("/market/robots.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("User-agent: *");
    expect(text).toContain("Allow: /");
    for (const path of ["/admin", "/api/", "/dashboard", "/login"]) {
      expect(text).toContain(`Disallow: /market${path}`);
    }
  });

  it("serves a readable security policy page with the contact address", async () => {
    const app = newApp();
    const response = await app.request("/security");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Security policy");
    expect(html).toContain("security@codeitlab.com");
    expect(html).toContain("In scope");
    expect(html).toContain("append-only ledger");
  });

  it("rejects non-GET methods", async () => {
    const app = newApp();
    expect((await app.request("/robots.txt", { method: "POST" })).status).toBe(405);
    expect((await app.request("/.well-known/security.txt", { method: "POST" })).status).toBe(405);
  });
});

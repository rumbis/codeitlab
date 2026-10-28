import { afterEach, describe, expect, it } from "vite-plus/test";

import { cookieHeader, createTestApp, setCookies, type TestApp } from "./helpers.ts";

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

describe("mounted at /market", () => {
  it("prefixes every internal link, asset and form action on rendered pages", async () => {
    const app = newApp({ basePath: "/market" });
    const home = await app.request("/market/");
    expect(home.status).toBe(200);
    const html = await home.text();

    expect(html).toContain('href="/market/jobs"');
    expect(html).toContain('href="/market/coders"');
    expect(html).toContain('href="/market/styles.css"');
    expect(html).toContain('href="/market/join?role=coder"');
    expect(html).toContain('href="/market/join?role=business"');
    expect(html).not.toContain('href="/jobs"');
    expect(html).not.toContain('href="/coders"');

    const internalPaths = [...html.matchAll(/(?:href|src|action)="(\/[^"]*)"/gu)]
      .map((match) => match[1] ?? "")
      .filter((path) => path !== "");
    expect(internalPaths.length).toBeGreaterThan(0);
    for (const path of internalPaths) {
      expect(path === "/market" || path.startsWith("/market/"), path).toBe(true);
    }

    const join = await (await app.request("/market/join")).text();
    expect(join).toContain('action="/market/api/auth/request-code"');
    expect(join).not.toContain('action="/api/auth/request-code"');

    const login = await (await app.request("/market/login")).text();
    expect(login).toContain('action="/market/api/auth/verify"');
    expect(login).toContain('action="/market/api/auth/request-code"');
  });

  it("prefixes redirects and scopes the session cookie to the mount path", async () => {
    const app = newApp({ basePath: "/market" });

    const requested = await app.request("/market/api/auth/request-code", {
      method: "POST",
      form: { email: "mounted@coders.test", role: "coder" },
    });
    expect(requested.status).toBe(303);
    expect(requested.headers.get("location")).toContain("/market/login?email=");

    const code = app.codes.get("mounted@coders.test");
    const verified = await app.request("/market/api/auth/verify", {
      method: "POST",
      form: { email: "mounted@coders.test", code: code ?? "", redirectTo: "/market/jobs" },
    });
    expect(verified.status).toBe(303);
    expect(
      new URL(verified.headers.get("location") ?? "", "http://marketplace.test").pathname,
    ).toBe("/market/jobs");
    expect(setCookies(verified)[0]).toContain("Path=/market");

    const cookie = cookieHeader(verified);
    const dashboard = await app.request("/market/dashboard", { cookie });
    expect(dashboard.status).toBe(200);
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain('action="/market/api/coders/profile"');
    expect(dashboardHtml).toContain('action="/market/api/auth/logout"');
  });

  it("also accepts paths without the mount prefix, for proxies that strip it", async () => {
    const app = newApp({ basePath: "/market" });

    for (const path of ["/", "/jobs", "/coders", "/join", "/login"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
    }

    const styles = await app.request("/styles.css");
    expect(styles.status).toBe(200);
    expect(styles.headers.get("content-type")).toContain("text/css");
  });
});

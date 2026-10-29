import { afterEach, describe, expect, it } from "vite-plus/test";

import { clientIp } from "../src/server/auth.ts";
import { createTestApp, TEST_ORIGIN, type TestApp } from "./helpers.ts";

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(): TestApp {
  const app = createTestApp({ baseUrl: TEST_ORIGIN });
  apps.push(app);
  return app;
}

describe("security headers", () => {
  it("sends a strict CSP and refuses framing on every page", async () => {
    const app = newApp();
    const response = await app.request("/");
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("permissions-policy")).toContain("payment=()");
  });

  it("does not advertise HSTS on a plain-http deployment", async () => {
    const app = newApp();
    const response = await app.request("/");
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });

  it("adds HSTS when the service is served over https", async () => {
    const app = createTestApp({ baseUrl: TEST_ORIGIN, cookieSecure: true });
    apps.push(app);
    const response = await app.request("/");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("keeps the headers on error responses too", async () => {
    const app = newApp();
    const response = await app.request("/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("same-origin enforcement", () => {
  it("rejects a cross-site form post", async () => {
    const app = newApp();
    const response = await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "victim@example.com", role: "coder" },
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("cross_origin");
    // The rejected request never created an account.
    expect(app.codes.size).toBe(0);
  });

  it("rejects a cross-site referer when the origin header is missing", async () => {
    const app = newApp();
    const response = await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "victim@example.com", role: "coder" },
      headers: { referer: "https://evil.example/form" },
    });
    expect(response.status).toBe(403);
  });

  it("accepts a same-origin post", async () => {
    const app = newApp();
    const response = await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "coder@example.com", role: "coder" },
      headers: { origin: TEST_ORIGIN },
    });
    expect(response.status).toBe(200);
  });

  it("does not block non-browser clients that send no origin", async () => {
    const app = newApp();
    const response = await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "coder@example.com", role: "coder" },
    });
    expect(response.status).toBe(200);
  });
});

describe("rate-limit identity", () => {
  it("ignores proxy headers unless a trusted proxy is configured", () => {
    const spoofed = new Request(TEST_ORIGIN, {
      headers: { "x-forwarded-for": "203.0.113.9", "x-marketplace-peer": "10.0.0.1" },
    });
    expect(clientIp(spoofed)).toBe("10.0.0.1");
    expect(
      clientIp(new Request(TEST_ORIGIN, { headers: { "x-forwarded-for": "203.0.113.9" } })),
    ).toBe("local");

    const behindProxy = new Request(TEST_ORIGIN, {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-marketplace-peer": "10.0.0.1" },
    });
    expect(clientIp(behindProxy, true)).toBe("203.0.113.9");
    const realIp = new Request(TEST_ORIGIN, { headers: { "x-real-ip": "198.51.100.4" } });
    expect(clientIp(realIp, true)).toBe("198.51.100.4");
  });

  it("keeps one bucket when a client rotates x-forwarded-for", async () => {
    const app = createTestApp({ baseUrl: TEST_ORIGIN });
    apps.push(app);
    const email = "rotate@spoof.test";
    for (let index = 0; index < 5; index += 1) {
      const response = await app.request("/api/auth/request-code", {
        method: "POST",
        headers: { "x-forwarded-for": `203.0.113.${index + 1}` },
        body: { email, role: "coder" },
      });
      expect(response.status).toBe(200);
    }
    const blocked = await app.request("/api/auth/request-code", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.99" },
      body: { email, role: "coder" },
    });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toBe("rate_limited");
  });

  it("uses the forwarded address as the bucket when the proxy is trusted", async () => {
    const app = createTestApp({ baseUrl: TEST_ORIGIN, trustProxy: true });
    apps.push(app);
    const email = "proxy@spoof.test";
    for (let index = 0; index < 5; index += 1) {
      const response = await app.request("/api/auth/request-code", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.7" },
        body: { email, role: "coder" },
      });
      expect(response.status).toBe(200);
    }
    const otherAddress = await app.request("/api/auth/request-code", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.8" },
      body: { email, role: "coder" },
    });
    expect(otherAddress.status).toBe(200);
  });
});

describe("cross-origin access for the local website", () => {
  const LOCAL_ORIGIN = "http://127.0.0.1:4173";

  it("sends no CORS headers when no origin is allowlisted", async () => {
    const app = newApp();
    const response = await app.request("/api/health", { headers: { origin: LOCAL_ORIGIN } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers an allowlisted origin and varies on it", async () => {
    const app = createTestApp({ baseUrl: TEST_ORIGIN, trustedOrigins: [LOCAL_ORIGIN] });
    apps.push(app);
    const response = await app.request("/api/health", { headers: { origin: LOCAL_ORIGIN } });
    expect(response.headers.get("access-control-allow-origin")).toBe(LOCAL_ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")?.toLowerCase()).toContain("origin");
  });

  it("never reflects an origin that is not allowlisted", async () => {
    const app = createTestApp({ baseUrl: TEST_ORIGIN, trustedOrigins: [LOCAL_ORIGIN] });
    apps.push(app);
    const response = await app.request("/api/health", {
      headers: { origin: "http://evil.test" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets an allowlisted origin post past the same-origin guard", async () => {
    const app = createTestApp({ baseUrl: TEST_ORIGIN, trustedOrigins: [LOCAL_ORIGIN] });
    apps.push(app);
    const allowed = await app.request("/api/auth/request-code", {
      method: "POST",
      headers: { origin: LOCAL_ORIGIN },
      body: { email: "local@example.com", role: "coder" },
    });
    expect(allowed.status).toBe(200);

    const blocked = await app.request("/api/auth/request-code", {
      method: "POST",
      headers: { origin: "http://evil.test" },
      body: { email: "local@example.com", role: "coder" },
    });
    expect(blocked.status).toBe(403);
  });

  it("answers the browser preflight without reaching a handler", async () => {
    const app = createTestApp({ baseUrl: TEST_ORIGIN, trustedOrigins: [LOCAL_ORIGIN] });
    apps.push(app);
    const response = await app.request("/api/auth/request-code", {
      method: "OPTIONS",
      headers: { origin: LOCAL_ORIGIN },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(LOCAL_ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("content-type");
  });
});

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

/**
 * The unit tests call `createApp` directly, so `main.ts` — the actual entrypoint
 * with its body collection, security headers, static files and base path — had
 * no coverage. This test boots the real process on a real port.
 */
let children: NodeChildProcess.ChildProcess[] = [];
let dirs: string[] = [];

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  children = [];
  for (const dir of dirs) NodeFS.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not answer /health in 10s");
}

describe("server entrypoint", () => {
  it("serves the marketplace from main.ts with the production headers", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "marketplace-entry-"));
    dirs.push(dir);
    const port = await freePort();
    const base = `http://127.0.0.1:${String(port)}`;
    const child = NodeChildProcess.spawn(process.execPath, ["src/server/main.ts"], {
      cwd: NodePath.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        MARKETPLACE_DB: NodePath.join(dir, "marketplace.sqlite"),
        MARKETPLACE_DEV_EMAIL: "1",
        MARKETPLACE_BASE_PATH: "/market",
        MARKETPLACE_BASE_URL: `${base}/market`,
        MARKETPLACE_ADMIN_TOKEN: "entry-test-admin-token-1234567890",
        MARKETPLACE_MAINTENANCE_MINUTES: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    await waitForHealth(`${base}/market`);

    const health = await fetch(`${base}/market/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await health.json()).toMatchObject({
      ok: true,
      service: "marketplace",
      schemaVersion: 25,
    });

    const home = await fetch(`${base}/market/`);
    expect(home.status).toBe(200);
    expect(home.headers.get("cache-control")).toBe("no-store");
    expect(await home.text()).toContain('href="/market/jobs"');

    const appJs = await fetch(`${base}/market/app.js`);
    expect(appJs.status).toBe(200);
    expect(appJs.headers.get("content-type")).toContain("javascript");
    const script = await appJs.text();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('replace(/\\+/g, "-")');

    const manifest = await fetch(`${base}/market/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    expect(((await manifest.json()) as { scope: string }).scope).toBe("/market/");

    const sitemap = await fetch(`${base}/market/sitemap.xml`);
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain(`${base}/market/`);
  }, 30_000);
});

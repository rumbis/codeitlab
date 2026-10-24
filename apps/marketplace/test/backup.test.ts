import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { backupDatabase } from "../src/server/backup.ts";
import { TEST_ADMIN_TOKEN, createTestApp } from "./helpers.ts";

let cleanups: string[] = [];
let closes: (() => void)[] = [];

afterEach(() => {
  for (const close of closes) close();
  closes = [];
  for (const dir of cleanups) NodeFS.rmSync(dir, { recursive: true, force: true });
  cleanups = [];
});

function tempDir(): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "marketplace-backup-"));
  cleanups.push(dir);
  return dir;
}

describe("database backups", () => {
  it("copies a live database, keeps its rows and passes integrity_check", async () => {
    const dir = tempDir();
    const dbPath = NodePath.join(dir, "live.sqlite");
    const app = createTestApp({ dbPath });
    closes.push(() => app.close());
    await app.signIn("owner@backup.test", "business");
    await app.signIn("coder@backup.test", "coder");

    const result = backupDatabase(dbPath, NodePath.join(dir, "backups"));
    expect(result.integrity).toBe("ok");
    expect(result.schemaVersion).toBe(23);
    expect(result.tables).toBeGreaterThan(10);
    expect(result.bytes).toBeGreaterThan(0);
    expect(NodeFS.existsSync(result.path)).toBe(true);

    const copy = new NodeSqlite.DatabaseSync(result.path, { readOnly: true });
    try {
      const accounts = copy.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
      expect(Number(accounts.n)).toBe(2);
      const audit = copy.prepare("SELECT COUNT(*) AS n FROM admin_audit").get() as { n: number };
      expect(Number(audit.n)).toBeGreaterThanOrEqual(0);
    } finally {
      copy.close();
    }
  });

  it("lets an operator trigger and audit a backup over HTTP", async () => {
    const dir = tempDir();
    const app = createTestApp({
      dbPath: NodePath.join(dir, "live.sqlite"),
      backupDir: NodePath.join(dir, "ops-backups"),
    });
    closes.push(() => app.close());
    await app.signIn("owner@backup.test", "business");

    const run = await app.json<{ path: string; integrity: string; schemaVersion: number }>(
      "/api/admin/backup/run",
      { method: "POST", headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } },
    );
    expect(run.response.status).toBe(200);
    expect(run.body.integrity).toBe("ok");
    expect(run.body.schemaVersion).toBe(23);
    expect(NodeFS.existsSync(run.body.path)).toBe(true);

    const audit = await app.json<{ entries: Array<{ action: string; detail: string }> }>(
      "/api/admin/audit",
      { headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } },
    );
    expect(audit.body.entries.some((entry) => entry.action === "backup.run")).toBe(true);

    const anonymous = await app.json<{ error: string }>("/api/admin/backup/run", {
      method: "POST",
    });
    expect(anonymous.response.status).toBe(401);
    expect(anonymous.body.error).toBe("admin_unauthorized");
  });

  it("answers 409 for an in-memory database instead of writing an empty file", async () => {
    const app = createTestApp();
    closes.push(() => app.close());
    const run = await app.json<{ error: string }>("/api/admin/backup/run", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
    expect(run.response.status).toBe(409);
    expect(run.body.error).toBe("in_memory_database");
  });

  it("refuses an in-memory or missing database instead of writing an empty file", () => {
    expect(() => backupDatabase(":memory:", tempDir())).toThrow(/in-memory/u);
    expect(() => backupDatabase("/nope/marketplace.sqlite", tempDir())).toThrow(/No database/u);
  });
});

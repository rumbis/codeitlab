import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

export interface BackupResult {
  readonly path: string;
  readonly bytes: number;
  /** Highest applied migration in the copy. */
  readonly schemaVersion: number;
  readonly tables: number;
  /** SQLite `PRAGMA integrity_check` on the copy; "ok" means usable. */
  readonly integrity: string;
}

/**
 * A consistent copy of a live SQLite database without stopping the server:
 * `VACUUM INTO` reads under one transaction and writes a defragmented file, so a
 * backup can run next to the maintenance loop. The copy is opened read-only and
 * checked before the function returns, so a corrupt backup is reported now, not
 * on the day it is needed.
 */
export function backupDatabase(
  dbPath: string,
  directory: string,
  now: Date = new Date(),
): BackupResult {
  if (dbPath === ":memory:") {
    throw new Error("An in-memory database has nothing to back up; set MARKETPLACE_DB first.");
  }
  const source = NodePath.resolve(dbPath);
  if (!NodeFS.existsSync(source)) {
    throw new Error(`No database at ${source}. Check MARKETPLACE_DB.`);
  }
  NodeFS.mkdirSync(directory, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const target = NodePath.join(directory, `marketplace-${stamp}.sqlite`);

  const db = new NodeSqlite.DatabaseSync(source);
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/gu, "''")}'`);
  } finally {
    db.close();
  }

  const copy = new NodeSqlite.DatabaseSync(target, { readOnly: true });
  try {
    const integrityRow = copy.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    const versionRow = copy
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as { version?: number | null } | undefined;
    const tablesRow = copy
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as { n: number };
    return {
      path: target,
      bytes: NodeFS.statSync(target).size,
      schemaVersion: Number(versionRow?.version ?? 0),
      tables: Number(tablesRow.n),
      integrity: integrityRow?.integrity_check ?? "unknown",
    };
  } finally {
    copy.close();
  }
}

/**
 * Consistent database copy: `pnpm --filter @codeitlab/marketplace backup`.
 * Prints JSON with the path, size, schema version and integrity check.
 * Exits 1 when the copy is not usable.
 */
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { backupDatabase } from "../src/server/backup.ts";

const appDir = NodePath.resolve(NodeURL.fileURLToPath(new URL("../../", import.meta.url)));
const dbPath = process.env.MARKETPLACE_DB ?? NodePath.join(appDir, ".data", "marketplace.sqlite");
const dirArg = process.argv.find((arg) => arg.startsWith("--dir="));
const directory =
  dirArg?.slice("--dir=".length) ??
  process.env.MARKETPLACE_BACKUP_DIR ??
  NodePath.join(appDir, ".data", "backups");

const result = backupDatabase(dbPath, directory);
console.log(JSON.stringify(result, null, 2));
if (result.integrity !== "ok") {
  console.error(`Backup failed its integrity check: ${result.integrity}`);
  process.exitCode = 1;
}

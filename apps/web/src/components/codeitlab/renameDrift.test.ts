// @effect-diagnostics nodeBuiltinImport:off - scans user-facing docs and panels for stale naming.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

/**
 * The rename rule: user-facing text says CodeItLab (or `cil` for an id). A few
 * technical ids are deliberately staged - the npm package scope, the internal
 * archive executable, the `app.t3.codes` origins, the legacy `~/.t3` home and
 * the `t3/` worktree branch prefix - and those are allowlisted here instead of
 * being quietly tolerated everywhere.
 */
const ROOT = new URL("../../../../../", import.meta.url);
const LEGACY = [
  /app\.t3\.codes/,
  /ingest\.t3\.codes/,
  /~\/\.t3/,
  /\.t3\//,
  /@t3tools\//,
  /t3code/,
  /T3CODE_/,
  /`t3`/,
  /`t3\/`/,
  /sudo t3 /,
  /`cil\.json`/,
  /staged legacy/,
  /\bt3\.json\b/,
];

const walk = (dir: string): Array<string> =>
  NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = NodePath.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const offenders = (files: Array<string>): Array<string> =>
  files.flatMap((file) =>
    NodeFS.readFileSync(file, "utf8")
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => /\bt3\b/i.test(line) && !LEGACY.some((rule) => rule.test(line)))
      .map(
        ({ line, number }) => `${NodePath.relative(ROOT.pathname, file)}:${number}: ${line.trim()}`,
      ),
  );

describe("rename drift", () => {
  it("keeps user docs free of the old product name", () => {
    const files = walk(NodePath.join(ROOT.pathname, "docs/user")).filter((file) =>
      file.endsWith(".md"),
    );
    expect(files.length).toBeGreaterThan(30);
    expect(offenders(files)).toEqual([]);
  });

  it("keeps CodeItLab panel text free of the old product name", () => {
    const files = walk(NodePath.join(ROOT.pathname, "apps/web/src/components/codeitlab")).filter(
      (file) => file.endsWith(".tsx"),
    );
    expect(offenders(files)).toEqual([]);
  });
});

// @effect-diagnostics nodeBuiltinImport:off - reads the escrow state machine and the guide.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(
  NodeURL.fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
);

const read = (relative: string): string =>
  NodeFS.readFileSync(NodePath.join(repoRoot, relative), "utf8");

const ENGAGEMENTS = "apps/marketplace/src/server/engagements.ts";
const USER_DOC = "docs/user/marketplace.md";

/** Backticked names in the guide. */
const ticks = (source: string): string[] =>
  [...source.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? "");

/** Double-quoted names in the TypeScript sources. */
const quotes = (source: string): string[] =>
  [...source.matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? "");

describe("marketplace transition guide", () => {
  it("lists every transition the server allows, and only those", () => {
    const source = read(ENGAGEMENTS);
    const block = /const ALLOWED_FROM[^=]*=\s*\{([\s\S]*?)\};/.exec(source)?.[1] ?? "";
    const allowed = new Map(
      [...block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map((match) => [
        match[1] ?? "",
        quotes(match[2] ?? ""),
      ]),
    );
    expect(allowed.size).toBeGreaterThan(0);

    const doc = read(USER_DOC);
    const rows = [...doc.matchAll(/^\| `([a-z_]+)`\s*\|([^|]+)\|([^|]+)\|$/gm)].map((match) => ({
      action: match[1] ?? "",
      from: ticks(match[2] ?? ""),
      ends: ticks(match[3] ?? ""),
    }));
    expect(rows.length).toBe(allowed.size);

    const documented = new Map(rows.map((row) => [row.action, row.from]));
    expect([...documented.keys()].sort()).toEqual([...allowed.keys()].sort());
    for (const [action, from] of allowed) expect(documented.get(action)).toEqual(from);
  });

  it("ends every transition in a status the deployment stores", () => {
    const contracts = read("apps/marketplace/src/shared/contracts.ts");
    const union = /export type EngagementStatus =([\s\S]*?);/.exec(contracts)?.[1] ?? "";
    const stored = new Set(quotes(union));
    const doc = read(USER_DOC);
    const ends = [...doc.matchAll(/^\| `[a-z_]+`\s*\|[^|]+\|\s*`([a-z_]+)`\s*\|$/gm)].map(
      (match) => match[1] ?? "",
    );
    expect(ends.length).toBeGreaterThan(0);
    for (const status of ends) expect(stored.has(status)).toBe(true);
  });
});

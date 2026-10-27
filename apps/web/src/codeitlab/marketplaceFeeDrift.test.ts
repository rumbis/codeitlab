// @effect-diagnostics nodeBuiltinImport:off - reads the money path and its copy to guard them.
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

const PANEL = "apps/web/src/components/codeitlab/CodeItLabMarketplacePage.tsx";
const CONTRACTS = "apps/marketplace/src/shared/contracts.ts";
const USER_DOC = "docs/user/marketplace.md";

const feeBps = (name: string): number => {
  const match = new RegExp(`export const ${name} = (\\d+);`).exec(read(CONTRACTS));
  expect(match, `${name} must stay a literal in contracts.ts`).not.toBeNull();
  return Number(match?.[1]);
};

describe("marketplace fee copy", () => {
  it("quotes the same percentages the money path charges", () => {
    const standard = feeBps("PLATFORM_FEE_BPS") / 100;
    const assisted = feeBps("ASSISTED_FEE_BPS") / 100;
    const panel = read(PANEL);
    const quoted = [...panel.matchAll(/<span className="tabular-nums">(\d+)%<\/span>/g)].map(
      (match) => Number(match[1]),
    );
    expect(quoted).toEqual([standard, assisted]);
    const doc = read(USER_DOC);
    for (const percent of [standard, assisted]) {
      expect(doc).toContain(`**${percent}%**`);
    }
  });

  it("explains every escrow state the deployment stores, and no other", () => {
    const contracts = read(CONTRACTS);
    const union = /export type EngagementStatus =([\s\S]*?);/.exec(contracts)?.[1] ?? "";
    const stored = [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
    expect(stored.length).toBeGreaterThan(0);
    const panel = read(PANEL);
    const explained = [...panel.matchAll(/<dt className="font-medium">([a-z_]+)<\/dt>/g)].map(
      (match) => match[1],
    );
    expect(explained).toEqual(stored);
  });
});

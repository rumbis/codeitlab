// @effect-diagnostics nodeBuiltinImport:off - reads the marketplace contracts from disk to compare copy.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

/**
 * The marketplace panel quotes a fee in prose, and the marketplace server owns
 * the number. This test fails if the two drift apart, so the panel cannot keep
 * promising 15% after the server moves to something else.
 */
const read = (relative: string) => NodeFS.readFileSync(new URL(relative, import.meta.url), "utf8");

const contracts = read("../../../../marketplace/src/shared/contracts.ts");
const panel = read("./CodeItLabMarketplacePage.tsx");
const readme = read("../../../../../README.md");
const marketplaceDoc = read("../../../../../docs/codeitlab/MARKETPLACE.md");

const bpsOf = (name: string): number => {
  const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(contracts);
  expect(match, `${name} missing from marketplace contracts`).not.toBeNull();
  return Number(match?.[1]);
};

describe("marketplace fee copy", () => {
  it("quotes the same self-serve percentage as the server", () => {
    const percent = bpsOf("PLATFORM_FEE_BPS") / 100;
    expect(panel).toContain(`${percent}%`);
  });

  it("quotes the same assisted percentage as the server", () => {
    const percent = bpsOf("ASSISTED_FEE_BPS") / 100;
    expect(panel).toContain(`${percent}%`);
  });

  it("quotes both server percentages in the README", () => {
    // The README is the first place a business reads the fee, so it has to name
    // both tiers instead of only the self-serve one.
    expect(readme).toContain(`${bpsOf("PLATFORM_FEE_BPS") / 100}% self-serve`);
    expect(readme).toContain(`${bpsOf("ASSISTED_FEE_BPS") / 100}% when the platform assists`);
  });

  it("quotes both server percentages in the marketplace constraint doc", () => {
    expect(marketplaceDoc).toContain(`${bpsOf("PLATFORM_FEE_BPS") / 100}% platform fee`);
    expect(marketplaceDoc).toContain(`${bpsOf("ASSISTED_FEE_BPS") / 100}%`);
  });

  it("keeps the fee inside the promised 15-20% band", () => {
    expect(bpsOf("PLATFORM_FEE_BPS")).toBeGreaterThanOrEqual(1500);
    expect(bpsOf("ASSISTED_FEE_BPS")).toBeLessThanOrEqual(2000);
  });
});

describe("marketplace escrow legend", () => {
  const statuses = (): ReadonlyArray<string> => {
    const match = /export type EngagementStatus\s*=([\s\S]*?);/.exec(contracts);
    expect(match, "EngagementStatus missing from marketplace contracts").not.toBeNull();
    return [...(match?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1] as string);
  };

  it("names every stored state in the panel", () => {
    const listed = statuses();
    expect(listed.length).toBeGreaterThan(0);
    for (const status of listed) {
      expect(panel, `${status} is missing from the panel legend`).toContain(`>${status}<`);
    }
  });

  it("names every stored state in the constraint doc too", () => {
    for (const status of statuses()) {
      expect(marketplaceDoc, `${status} is missing from docs/codeitlab/MARKETPLACE.md`).toMatch(
        new RegExp(`\\b${status}\\b`),
      );
    }
  });

  it("does not invent states the server never stores", () => {
    const listed = new Set(statuses());
    for (const match of panel.matchAll(/<dt className="font-medium">([a-z_]+)<\/dt>/g)) {
      expect(listed.has(match[1] as string), `${match[1]} is not an EngagementStatus`).toBe(true);
    }
  });
});

describe("marketplace dispute copy", () => {
  const disputes = read("../../../../marketplace/src/server/disputes.ts");

  it("names every outcome the deployment can record", () => {
    const match = /DISPUTE_OUTCOMES\s*=\s*\[([^\]]+)\]/.exec(disputes);
    expect(match, "DISPUTE_OUTCOMES missing from the marketplace server").not.toBeNull();
    const outcomes = [...(match?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map(
      (entry) => entry[1] as string,
    );
    expect(outcomes.length).toBeGreaterThan(0);
    for (const outcome of outcomes) {
      expect(panel, `${outcome} is missing from the panel`).toContain(outcome);
    }
  });

  it("says the decision needs a written reason", () => {
    expect(panel).toContain("written reason");
    expect(disputes).toContain("resolution note is required");
  });

  it("does not claim the app mediates disputes", () => {
    expect(panel).toContain("This app does not mediate");
  });
});

describe("marketplace pre-payment copy", () => {
  const engagements = read("../../../../marketplace/src/server/engagements.ts");

  it("keeps the amount inside the posted budget range", () => {
    expect(engagements).toContain("maximum budget");
    expect(panel).toContain("budget range");
  });

  it("states that a job has one active engagement", () => {
    expect(engagements).toContain("already has an engagement");
    expect(panel).toContain("one active engagement");
  });

  it("states the assisted tier cannot be charged as self-serve", () => {
    expect(engagements).toContain("assisted_tier_required");
    expect(panel).toContain("cannot be charged at the self-serve tier");
  });
});

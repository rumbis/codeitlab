import { describe, expect, it } from "vite-plus/test";

import {
  FREEMIUM_AGENTS,
  PREMIUM_AGENTS,
  agentAvailability,
  regionCountryFromLocale,
  regionCountryFromTimeZone,
} from "./freemiumAgents";

describe("agent catalog tiers", () => {
  it("splits the curated registry into freemium and premium without overlap", () => {
    // Free-only policy: the freemium tab is exactly the agents the 2026-10-24
    // free-tier audit (docs/codeitlab/ACP-FREE-TIERS.md) found usable at $0.
    expect(FREEMIUM_AGENTS).toHaveLength(16);
    expect(PREMIUM_AGENTS).toHaveLength(27);
    expect(FREEMIUM_AGENTS.every((agent) => agent.tier === "freemium")).toBe(true);
    expect(PREMIUM_AGENTS.every((agent) => agent.tier === "premium")).toBe(true);
    const ids = [...FREEMIUM_AGENTS, ...PREMIUM_AGENTS].map((agent) => agent.id);
    expect(new Set(ids).size).toBe(43);
  });

  it("keeps only agents with a free model or free tier in the free list", () => {
    expect(FREEMIUM_AGENTS.every((agent) => agent.kind === "free-tier")).toBe(true);
    const ids = new Set(FREEMIUM_AGENTS.map((agent) => agent.id));
    for (const id of ["gemini", "codex-acp", "grok-build", "antigravity-acp", "opencode-v2"]) {
      expect(ids.has(id)).toBe(true);
    }
    // Open source alone is not free usage: BYO-key agents moved to premium.
    for (const id of ["goose", "qwen-code", "pi-acp", "harn"]) {
      expect(ids.has(id)).toBe(false);
    }
  });

  it("keeps MiniMax available as an option while flagging Cyprus", () => {
    const minimax = PREMIUM_AGENTS.find((agent) => agent.id === "minimax-code");
    expect(minimax?.availability?.reportedBlockedCountries).toContain("CY");
    expect(minimax?.availability?.blockedCountries).toBeUndefined();
    expect(minimax?.availability?.note).toContain("UNVERIFIED");
    expect(agentAvailability(minimax ?? {}, "CY")).toBe("reported-unavailable");
    expect(agentAvailability(minimax ?? {}, "US")).toBe("unknown");
  });
});

describe("regionCountryFromLocale", () => {
  it("reads the region from common locales", () => {
    expect(regionCountryFromLocale("en-CY")).toBe("CY");
    expect(regionCountryFromLocale("el-GR")).toBe("GR");
    expect(regionCountryFromLocale("en-US")).toBe("US");
    expect(regionCountryFromLocale("en-GB")).toBe("GB");
    expect(regionCountryFromLocale("zh-Hant-TW")).toBe("TW");
    expect(regionCountryFromLocale("en-CY-u-nu-latn")).toBe("CY");
  });

  it("maps the time zone when the locale has no region", () => {
    expect(regionCountryFromTimeZone("Asia/Nicosia")).toBe("CY");
    expect(regionCountryFromTimeZone("Europe/Athens")).toBe("GR");
    expect(regionCountryFromTimeZone("Pacific/Kiritimati")).toBeNull();
  });
});

describe("agentAvailability", () => {
  it("treats missing data as unknown", () => {
    expect(agentAvailability({}, "CY")).toBe("unknown");
    expect(agentAvailability({}, null)).toBe("unknown");
    expect(agentAvailability({ availability: { note: "check the vendor" } }, "CY")).toBe("unknown");
  });

  it("honours blocked and allowed country lists", () => {
    const blocked = { availability: { blockedCountries: ["cy"] } };
    expect(agentAvailability(blocked, "CY")).toBe("unavailable");
    expect(agentAvailability(blocked, "US")).toBe("unknown");

    const allowed = { availability: { countries: ["US", "CA"] } };
    expect(agentAvailability(allowed, "us")).toBe("available");
    expect(agentAvailability(allowed, "CY")).toBe("unavailable");
  });
});

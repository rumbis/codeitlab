import { describe, expect, it } from "@effect/vitest";

import { hasFreeTier, isFreeModel, isQuotaExemptFreeModel } from "./freeModels.ts";

describe("free models", () => {
  it("counts a free model on an agent that runs free promotions", () => {
    const opencode = { agentId: "opencode", driverKind: "opencode" } as const;
    expect(isFreeModel(opencode, "glm-5.3-flash-free")).toBe(true);
    expect(isFreeModel(opencode, "provider/nemotron-3")).toBe(true);
    expect(isFreeModel(opencode, "mimo-7b")).toBe(true);
    expect(isFreeModel(opencode, "provider/model:free")).toBe(true);
    // A paid sibling on the same provider is not free.
    expect(isFreeModel(opencode, "claude-opus-5")).toBe(false);
  });

  it("treats on-device models as free and free plans as allowance-limited", () => {
    expect(isFreeModel({ agentId: "sigit" }, "any-gguf-model")).toBe(true);
    // A $0 plan is free to subscribe to, but its usage is what the quota measures.
    expect(hasFreeTier({ agentId: "codex-acp", driverKind: "codex" })).toBe(true);
    expect(isFreeModel({ agentId: "codex-acp", driverKind: "codex" }, "gpt-5.4")).toBe(false);
    expect(isQuotaExemptFreeModel({ agentId: "opencode" }, "gemini-3-flash-free")).toBe(true);
    expect(isQuotaExemptFreeModel({ agentId: "codex-acp" }, "gpt-5.4")).toBe(false);
  });

  it("answers no for agents and models it does not know", () => {
    expect(isFreeModel({ agentId: "devin" }, "devin-fast")).toBe(false);
    expect(isFreeModel({ driverKind: "claude" }, "claude-opus-5")).toBe(false);
    expect(isFreeModel({ agentId: "opencode" }, "   ")).toBe(false);
    expect(hasFreeTier({})).toBe(false);
  });
});

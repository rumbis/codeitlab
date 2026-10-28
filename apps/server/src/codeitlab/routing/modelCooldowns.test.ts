import { afterEach, describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_MODEL_COOLDOWN_MINUTES,
  clearModelCooldown,
  coolingDownModels,
  isModelCoolingDown,
  modelCooldownFor,
  recordModelCooldown,
  resetModelCooldowns,
} from "./modelCooldowns.ts";

const MINUTE_MS = 60_000;

afterEach(() => {
  resetModelCooldowns();
});

describe("model cooldowns", () => {
  it("keeps a failed model out for a day by default", () => {
    const nowMs = 1_000_000;
    recordModelCooldown({
      providerInstanceId: "hermes",
      model: "openai/gpt-5",
      reason: "Timed out waiting for the reply.",
      nowMs,
    });

    expect(DEFAULT_MODEL_COOLDOWN_MINUTES).toBe(24 * 60);
    expect(isModelCoolingDown("hermes", "openai/gpt-5", nowMs + 1)).toBe(true);
    expect(isModelCoolingDown("hermes", "openai/gpt-5", nowMs + 23 * 60 * MINUTE_MS)).toBe(true);
    expect(isModelCoolingDown("hermes", "openai/gpt-5", nowMs + 24 * 60 * MINUTE_MS)).toBe(false);
    expect(modelCooldownFor("hermes", "openai/gpt-5")?.reason).toBe(
      "Timed out waiting for the reply.",
    );
  });

  it("only covers the model that failed, not its free siblings", () => {
    const nowMs = 5_000;
    recordModelCooldown({
      providerInstanceId: "hermes",
      model: "openai/gpt-5",
      reason: "no answer",
      nowMs,
    });

    expect(isModelCoolingDown("hermes", "glm-5.3-flash-free", nowMs + 1)).toBe(false);
    expect(isModelCoolingDown("cursor", "openai/gpt-5", nowMs + 1)).toBe(false);
  });

  it("lists what is cooling down and lets one model back in early", () => {
    const nowMs = 10_000;
    recordModelCooldown({ providerInstanceId: "hermes", model: "a", reason: "x", nowMs });
    recordModelCooldown({ providerInstanceId: "hermes", model: "b", reason: "x", nowMs });

    expect(
      coolingDownModels(nowMs + 1)
        .map((entry) => entry.model)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(clearModelCooldown("hermes", "a")).toBe(true);
    expect(coolingDownModels(nowMs + 1).map((entry) => entry.model)).toEqual(["b"]);
    expect(clearModelCooldown("hermes", "a")).toBe(false);
  });

  it("takes an explicit window and ignores empty identifiers", () => {
    const nowMs = 77_000;
    recordModelCooldown({
      providerInstanceId: "hermes",
      model: "c",
      reason: "x",
      cooldownMinutes: 5,
      nowMs,
    });

    expect(isModelCoolingDown("hermes", "c", nowMs + 4 * MINUTE_MS)).toBe(true);
    expect(isModelCoolingDown("hermes", "c", nowMs + 5 * MINUTE_MS)).toBe(false);
    expect(
      recordModelCooldown({ providerInstanceId: "", model: "c", reason: "x", nowMs }),
    ).toBeUndefined();
    expect(
      recordModelCooldown({ providerInstanceId: "hermes", model: "", reason: "x", nowMs }),
    ).toBeUndefined();
  });
});

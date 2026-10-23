import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import {
  fallbackModelOptions,
  fallbackProviderOptions,
  FIRST_HEALTHY_PROVIDER_LABEL,
  isFallbackDecision,
  PROVIDER_DEFAULT_MODEL_LABEL,
  PROVIDER_FAILURE_COOLDOWN_OPTIONS,
} from "./fallbackSettings.ts";

describe("fallbackProviderOptions", () => {
  it("offers the automatic choice first when there are no instances", () => {
    assert.deepStrictEqual(fallbackProviderOptions([]), [
      { value: "", label: FIRST_HEALTHY_PROVIDER_LABEL },
    ]);
  });

  it("brands each enabled instance and keeps catalog order", () => {
    assert.deepStrictEqual(
      fallbackProviderOptions([
        { providerInstanceId: "hermes", name: "Hermes" },
        { providerInstanceId: "claude", name: "Claude" },
      ]),
      [
        { value: "", label: "First healthy provider" },
        { value: "hermes", label: "CodeitLab Hermes" },
        { value: "claude", label: "CodeitLab Claude" },
      ],
    );
  });

  it("drops blank and duplicate instance ids", () => {
    assert.deepStrictEqual(
      fallbackProviderOptions([
        { providerInstanceId: " ", name: "Blank" },
        { providerInstanceId: "hermes", name: "Hermes" },
        { providerInstanceId: "hermes", name: "Hermes copy" },
      ]),
      [
        { value: "", label: "First healthy provider" },
        { value: "hermes", label: "CodeitLab Hermes" },
      ],
    );
  });
});

describe("fallbackModelOptions", () => {
  it("offers the provider default when the catalog has no models", () => {
    assert.deepStrictEqual(fallbackModelOptions(undefined), [
      { value: "", label: PROVIDER_DEFAULT_MODEL_LABEL },
    ]);
    assert.deepStrictEqual(fallbackModelOptions([]), [
      { value: "", label: PROVIDER_DEFAULT_MODEL_LABEL },
    ]);
  });

  it("lists model slugs after the default and de-duplicates them", () => {
    assert.deepStrictEqual(
      fallbackModelOptions(["deepseek-v4", " ", "qwen3-coder", "deepseek-v4"]),
      [
        { value: "", label: "Provider default" },
        { value: "deepseek-v4", label: "deepseek-v4" },
        { value: "qwen3-coder", label: "qwen3-coder" },
      ],
    );
  });
});

describe("isFallbackDecision", () => {
  it("matches the server's fallback wording", () => {
    assert.isTrue(
      isFallbackDecision(
        "fell back to CodeitLab Claude because CodeitLab Hermes failed (HTTP 502)",
      ),
    );
    assert.isTrue(isFallbackDecision("Fell back to CodeitLab Claude because NVIDIA NIM failed"));
  });

  it("ignores normal routing reasons", () => {
    assert.isFalse(isFallbackDecision("Fastest coding model with quota headroom"));
    assert.isFalse(isFallbackDecision("fallback is allowed but the primary answered"));
    assert.isFalse(isFallbackDecision(""));
  });
});

describe("PROVIDER_FAILURE_COOLDOWN_OPTIONS", () => {
  it("offers 5, 10, 30, and 60 minutes", () => {
    assert.deepStrictEqual([...PROVIDER_FAILURE_COOLDOWN_OPTIONS], [5, 10, 30, 60]);
  });
});

import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import {
  codeitlabProviderKindLabel,
  codeitlabProviderLabel,
  codeitlabProviderName,
} from "./providerLabels.ts";

describe("provider labels", () => {
  it("maps known driver ids to branded names", () => {
    assert.strictEqual(codeitlabProviderLabel("hermes"), "CodeItLab Hermes");
    assert.strictEqual(codeitlabProviderLabel("claudeAgent"), "CodeItLab Claude");
    assert.strictEqual(codeitlabProviderLabel("codex"), "CodeItLabx");
    assert.strictEqual(codeitlabProviderLabel("muse"), "CodeItLab Muse Code");
  });

  it("humanizes ACP registry instance ids", () => {
    assert.strictEqual(codeitlabProviderLabel("acpRegistry_qoder_cli"), "CodeItLab Qoder CLI");
    assert.strictEqual(codeitlabProviderLabel("acpRegistry_nvidia_nim"), "CodeItLab Nvidia NIM");
  });

  it("falls back to a humanized id and never returns a raw id", () => {
    assert.strictEqual(codeitlabProviderLabel("my-agent_2"), "CodeItLab My Agent 2");
    assert.strictEqual(codeitlabProviderLabel(""), "CodeItLab Agent");
  });

  it("brands snapshot names idempotently", () => {
    assert.strictEqual(codeitlabProviderName("hermes"), "CodeItLab Hermes");
    assert.strictEqual(codeitlabProviderName("CodeItLab Hermes"), "CodeItLab Hermes");
    assert.strictEqual(codeitlabProviderName("Qoder CLI"), "CodeItLab Qoder CLI");
    assert.strictEqual(codeitlabProviderName(null), "CodeItLab Agent");
    // A server that already prefixed a raw id must not leak `CodeItLab hermes`.
    assert.strictEqual(codeitlabProviderName("CodeItLab hermes"), "CodeItLab Hermes");
    assert.strictEqual(codeitlabProviderName("CodeItLab claudeAgent"), "CodeItLab Claude");
    assert.strictEqual(codeitlabProviderName("CodeItLab codex"), "CodeItLabx");
  });
});

describe("provider names and kinds", () => {
  it("title-cases names that already carry the brand prefix", () => {
    assert.strictEqual(codeitlabProviderName("CodeItLab hermes"), "CodeItLab Hermes");
    assert.strictEqual(codeitlabProviderName("CodeItLab claudeAgent"), "CodeItLab Claude");
    assert.strictEqual(codeitlabProviderName("CodeItLab Qoder CLI"), "CodeItLab Qoder CLI");
    assert.strictEqual(codeitlabProviderName("hermes"), "CodeItLab Hermes");
    assert.strictEqual(codeitlabProviderName(null), "CodeItLab Agent");
  });

  it("labels driver kinds without a second brand prefix", () => {
    assert.strictEqual(codeitlabProviderKindLabel("hermes"), "Hermes");
    assert.strictEqual(codeitlabProviderKindLabel("acpRegistry"), "ACP");
    assert.strictEqual(codeitlabProviderKindLabel("claudeAgent"), "Claude");
    assert.strictEqual(codeitlabProviderKindLabel(""), "Agent");
  });
});

import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import {
  codeitlabProviderKindLabel,
  codeitlabProviderLabel,
  codeitlabProviderName,
} from "./providerLabels.ts";

describe("provider labels", () => {
  it("maps known driver ids to branded names", () => {
    assert.strictEqual(codeitlabProviderLabel("hermes"), "CodeitLab Hermes");
    assert.strictEqual(codeitlabProviderLabel("claudeAgent"), "CodeitLab Claude");
    assert.strictEqual(codeitlabProviderLabel("codex"), "CodeitLab Codex");
    assert.strictEqual(codeitlabProviderLabel("muse"), "CodeitLab Muse Code");
  });

  it("humanizes ACP registry instance ids", () => {
    assert.strictEqual(codeitlabProviderLabel("acpRegistry_qoder_cli"), "CodeitLab Qoder CLI");
    assert.strictEqual(codeitlabProviderLabel("acpRegistry_nvidia_nim"), "CodeitLab Nvidia NIM");
  });

  it("falls back to a humanized id and never returns a raw id", () => {
    assert.strictEqual(codeitlabProviderLabel("my-agent_2"), "CodeitLab My Agent 2");
    assert.strictEqual(codeitlabProviderLabel(""), "CodeitLab Agent");
  });

  it("brands snapshot names idempotently", () => {
    assert.strictEqual(codeitlabProviderName("hermes"), "CodeitLab Hermes");
    assert.strictEqual(codeitlabProviderName("CodeitLab Hermes"), "CodeitLab Hermes");
    assert.strictEqual(codeitlabProviderName("Qoder CLI"), "CodeitLab Qoder CLI");
    assert.strictEqual(codeitlabProviderName(null), "CodeitLab Agent");
    // A server that already prefixed a raw id must not leak `CodeitLab hermes`.
    assert.strictEqual(codeitlabProviderName("CodeitLab hermes"), "CodeitLab Hermes");
    assert.strictEqual(codeitlabProviderName("CodeitLab claudeAgent"), "CodeitLab Claude");
    assert.strictEqual(codeitlabProviderName("CodeitLab codex"), "CodeitLab Codex");
  });
});

describe("provider names and kinds", () => {
  it("title-cases names that already carry the brand prefix", () => {
    assert.strictEqual(codeitlabProviderName("CodeitLab hermes"), "CodeitLab Hermes");
    assert.strictEqual(codeitlabProviderName("CodeitLab claudeAgent"), "CodeitLab Claude");
    assert.strictEqual(codeitlabProviderName("CodeitLab Qoder CLI"), "CodeitLab Qoder CLI");
    assert.strictEqual(codeitlabProviderName("hermes"), "CodeitLab Hermes");
    assert.strictEqual(codeitlabProviderName(null), "CodeitLab Agent");
  });

  it("labels driver kinds without a second brand prefix", () => {
    assert.strictEqual(codeitlabProviderKindLabel("hermes"), "Hermes");
    assert.strictEqual(codeitlabProviderKindLabel("acpRegistry"), "ACP");
    assert.strictEqual(codeitlabProviderKindLabel("claudeAgent"), "Claude");
    assert.strictEqual(codeitlabProviderKindLabel(""), "Agent");
  });
});

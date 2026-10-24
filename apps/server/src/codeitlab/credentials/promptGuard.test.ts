import { DEFAULT_CODEITLAB_SETTINGS } from "@codeitlab/core";
import type { CodeitlabCredentialsSettings } from "@codeitlab/core/credentials";
import { describe, expect, it } from "vite-plus/test";

import { guardProviderPrompt, restoreAppTurnFakes } from "./promptGuard.ts";

const settings = (
  overrides: Partial<CodeitlabCredentialsSettings> = {},
): CodeitlabCredentialsSettings => ({
  ...DEFAULT_CODEITLAB_SETTINGS.credentials,
  enabled: true,
  ...overrides,
});

const KEY = "sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789";

describe("guardProviderPrompt", () => {
  it("leaves the prompt untouched while the firewall is off", () => {
    const result = guardProviderPrompt(settings({ enabled: false }), `key ${KEY}`);
    expect(result.text).toBe(`key ${KEY}`);
    expect(result.findings).toBe(0);
    expect(result.blocked).toBe(false);
  });

  it("masks credentials and personal data by default", () => {
    const result = guardProviderPrompt(
      DEFAULT_CODEITLAB_SETTINGS.credentials,
      `key ${KEY}\nemail anna@example.com\nnothing else`,
    );
    expect(result.text).not.toContain(KEY);
    expect(result.text).not.toContain("anna@example.com");
    expect(result.text).toContain("nothing else");
    expect(result.findings).toBeGreaterThanOrEqual(2);
    expect(result.blocked).toBe(false);
  });

  it("leaves personal data alone when the personal switch is off", () => {
    const result = guardProviderPrompt(
      settings({ maskPersonalData: false }),
      `key ${KEY}\nemail anna@example.com\nnothing else`,
    );
    expect(result.text).not.toContain(KEY);
    expect(result.text).toContain("anna@example.com");
    expect(result.text).toContain("nothing else");
  });

  it("restores the real values in provider output", () => {
    const text = `my key is ${KEY} and email anna@example.com`;
    const guarded = guardProviderPrompt(settings({ maskPersonalData: true }), text);
    expect(guarded.text).not.toContain(KEY);
    expect(guarded.text).not.toContain("anna@example.com");
    expect(restoreAppTurnFakes(guarded.text)).toBe(text);
    expect(restoreAppTurnFakes({ message: { text: guarded.text }, items: [guarded.text] })).toEqual(
      {
        message: { text },
        items: [text],
      },
    );
    expect(restoreAppTurnFakes("nothing to restore here")).toBe("nothing to restore here");
    // Non-plain values must pass through untouched, not become keyed objects.
    const when = new Date(0);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(restoreAppTurnFakes({ when, bytes })).toEqual({ when, bytes });
  });

  it("is deterministic for the same value", () => {
    const first = guardProviderPrompt(settings(), `key ${KEY}`);
    const second = guardProviderPrompt(settings(), `key ${KEY}`);
    expect(second.text).toBe(first.text);
  });

  it("blocks a /private block in block mode and masks it in mask mode", () => {
    const text = "here /private my home address /private";
    expect(guardProviderPrompt(settings(), text).blocked).toBe(false);
    expect(guardProviderPrompt(settings(), text).text).not.toContain("home address");
    const blocked = guardProviderPrompt(settings({ privateTag: "block" }), text);
    expect(blocked.blocked).toBe(true);
    expect(blocked.text).not.toContain("home address");
  });

  it("only blocks a model-only finding when blockOnModelFlag is on", () => {
    const text = "the password is QwErTyUiOpAsDfGhJkLzXcVbNm";
    const masked = guardProviderPrompt(settings(), text);
    expect(masked.findings).toBeGreaterThan(0);
    expect(masked.blocked).toBe(false);
    expect(masked.text).not.toContain("QwErTyUiOpAsDfGhJkLzXcVbNm");
    expect(guardProviderPrompt(settings({ blockOnModelFlag: true }), text).blocked).toBe(true);
  });
});

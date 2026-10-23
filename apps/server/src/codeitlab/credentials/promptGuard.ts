import type { CodeitlabCredentialsSettings } from "@codeitlab/core/credentials";
import { maskText } from "@codeitlab/core/credentials/engine";
import { bundledCredentialModel } from "@codeitlab/core/credentials/model";

/**
 * Namespace for fakes created on the provider-turn path. The gateway and the
 * preview scan use the vault-keyed namespace, so their fakes differ from these;
 * keeping a separate constant means the turn guard never needs the vault and
 * therefore never races the credentials service for the key file.
 */
export const APP_TURN_FAKE_KEY = "codeitlab-app-turn-fakes-v1";

export interface GuardedProviderPrompt {
  readonly text: string;
  readonly findings: number;
  /** True when the prompt must not reach the provider. */
  readonly blocked: boolean;
}

/**
 * Masks the prompt a built-in provider adapter is about to receive. Pure and
 * synchronous: the engine and the bundled model need no services, so the
 * provider dispatch path can call it without touching the credentials service.
 */
export function guardProviderPrompt(
  settings: CodeitlabCredentialsSettings,
  text: string,
): GuardedProviderPrompt {
  if (!settings.enabled || text.length === 0) {
    return { text, findings: 0, blocked: false };
  }
  const result = maskText(text, {
    mode: settings.mode,
    privateTag: settings.privateTag,
    maskPersonalData: settings.maskPersonalData,
    fakeKey: APP_TURN_FAKE_KEY,
    model: bundledCredentialModel(),
  });
  const modelBlocked =
    settings.blockOnModelFlag && result.findings.some((finding) => finding.source === "model");
  return {
    text: result.masked,
    findings: result.findings.length,
    blocked: result.blocked || modelBlocked,
  };
}

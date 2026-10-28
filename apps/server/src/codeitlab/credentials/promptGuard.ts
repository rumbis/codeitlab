import type { CodeItLabCredentialsSettings } from "@codeitlab/core/credentials";
import { CredentialVault, maskText } from "@codeitlab/core/credentials/engine";
import { bundledCredentialModel } from "@codeitlab/core/credentials/model";

/**
 * Namespace for fakes created on the provider-turn path. The gateway and the
 * preview scan use the vault-keyed namespace, so their fakes differ from these;
 * keeping a separate constant means the turn guard never needs the vault and
 * therefore never races the credentials service for the key file.
 */
export const APP_TURN_FAKE_KEY = "codeitlab-app-turn-fakes-v1";

/**
 * The fake -> original map for app-driven turns. It lives in memory only: the
 * dispatch path never touches the credentials vault file, and a restart simply
 * loses the ability to restore fakes from earlier turns (new turns re-mask the
 * same values to the same deterministic fakes, so they stay consistent).
 */
let appTurnVault = new CredentialVault();
/** A prompt with thousands of distinct secrets is not a prompt; bound the map. */
const APP_TURN_VAULT_LIMIT = 4096;

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
  settings: CodeItLabCredentialsSettings,
  text: string,
): GuardedProviderPrompt {
  if (!settings.enabled || text.length === 0) {
    return { text, findings: 0, blocked: false };
  }
  const result = maskText(
    text,
    {
      mode: settings.mode,
      privateTag: settings.privateTag,
      maskPersonalData: settings.maskPersonalData,
      fakeKey: APP_TURN_FAKE_KEY,
      model: bundledCredentialModel(),
    },
    appTurnVault,
  );
  if (appTurnVault.size > APP_TURN_VAULT_LIMIT) {
    appTurnVault = new CredentialVault();
  }
  const modelBlocked =
    settings.blockOnModelFlag && result.findings.some((finding) => finding.source === "model");
  return {
    text: result.masked,
    findings: result.findings.length,
    blocked: result.blocked || modelBlocked,
  };
}

function restoreDeep(value: unknown): unknown {
  if (typeof value === "string") return appTurnVault.restore(value).text;
  if (Array.isArray(value)) return value.map(restoreDeep);
  // Provider events are plain JSON, but a future field could carry a Date or a
  // typed array. Only copy plain objects, so restoring can never rewrite one
  // into an object of numbered keys.
  if (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = restoreDeep(item);
    }
    return out;
  }
  return value;
}

/**
 * Put the real values back into provider output (assistant text, reasoning,
 * tool output, diffs) before the event is persisted or sent to a client. The
 * model only ever saw fakes, so anything that matches a remembered fake is a
 * value the user typed earlier.
 */
export function restoreAppTurnFakes<T>(value: T): T {
  if (appTurnVault.size === 0) return value;
  return restoreDeep(value) as T;
}

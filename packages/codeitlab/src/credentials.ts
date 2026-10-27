import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Credentials proxy contracts — the local privacy firewall.
 *
 * CodeItLab sits between the agent and the model: before a request leaves the
 * machine, secrets (API keys, passwords, tokens, private keys, connection
 * strings) and the contents of `/private` blocks are replaced with
 * deterministic, format-preserving fakes; the mapping stays on this machine and
 * the real values are restored in answers and tool output. Everything here is
 * display/contract only — values are never carried by these schemas.
 *
 * The design follows the same idea as Latet (https://github.com/Latet-AI/latet)
 * but is implemented natively in CodeItLab: detectors plus the smallest local
 * model that can check credentials, no Python service, no third-party account.
 */

const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const NumberDefault = (value: number) =>
  Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const TrimmedStringDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

/** How much the proxy masks. `secrets` is the narrow profile, `max` adds private network data. */
export const CodeItLabCredentialsMode = Schema.Literals(["secrets", "balanced", "max"]);
export type CodeItLabCredentialsMode = typeof CodeItLabCredentialsMode.Type;

/** What happens to text inside `/private` blocks: replace it, or refuse to send the request. */
export const CodeItLabPrivateTagBehavior = Schema.Literals(["mask", "block"]);
export type CodeItLabPrivateTagBehavior = typeof CodeItLabPrivateTagBehavior.Type;

/** Local gateway port; provider base URLs point here when the proxy is on. */
export const CREDENTIALS_PROXY_DEFAULT_PORT = 5284;

/** The tag pairs the proxy recognises. Opening and closing use the same token for `/private`. */
export const CREDENTIALS_PRIVATE_TAG_PAIRS = [
  ["/private", "/private"],
  ["[private]", "[/private]"],
  ["<private>", "</private>"],
] as const;

/** Built-in tiny credential model (weights shipped with the app, updatable by download). */
export const CREDENTIALS_DEFAULT_MODEL_ID = "codeitlab-tiny-credentials";

/** Where an updated model file can be downloaded from (release asset); empty means bundled only. */
export const CREDENTIALS_MODEL_DOWNLOAD_URL =
  "https://github.com/rumbis/codeitlab/releases/latest/download/codeitlab-tiny-credentials.json";

export const CodeItLabCredentialsSettings = Schema.Struct({
  /**
   * On by default: a prompt that leaves for a provider has its credentials
   * replaced locally first. Secrets never need to leave the machine, so the
   * safe direction is the default one; a user who wants raw prompts can still
   * switch it off.
   */
  enabled: BooleanDefault(true),
  mode: CodeItLabCredentialsMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("balanced" as const)),
  ),
  /** Local HTTP gateway the provider base URLs can point at. */
  gatewayPort: NumberDefault(CREDENTIALS_PROXY_DEFAULT_PORT),
  privateTag: CodeItLabPrivateTagBehavior.pipe(
    Schema.withDecodingDefault(Effect.succeed("mask" as const)),
  ),
  /**
   * Personal data is masked by default: emails, phone numbers, IBANs and card
   * numbers are replaced before they leave, and the real values are restored in
   * the output, so fixtures and migrations keep the addresses the user wrote.
   * Turn it off when a task needs the raw values to reason about them.
   */
  maskPersonalData: BooleanDefault(true),
  /** Mask the originals back into answers and tool output before they reach disk or the UI. */
  restoreResponses: BooleanDefault(true),
  /** Refuse a request the local model flags as sensitive but the detectors cannot classify. */
  blockOnModelFlag: BooleanDefault(false),
  /** The local model that checks credentials. */
  modelId: TrimmedStringDefault(CREDENTIALS_DEFAULT_MODEL_ID),
  /** Optional local reviewer (Ollama, llama.cpp server, LM Studio); empty means built-in model only. */
  reviewerUrl: TrimmedStringDefault(""),
  reviewerModel: TrimmedStringDefault(""),
  /** How many audit entries stay in memory for the settings page. */
  auditLimit: NumberDefault(500),
});
export type CodeItLabCredentialsSettings = typeof CodeItLabCredentialsSettings.Type;

export const CodeItLabCredentialsModelState = Schema.Literals([
  "bundled",
  "downloading",
  "ready",
  "error",
]);
export type CodeItLabCredentialsModelState = typeof CodeItLabCredentialsModelState.Type;

export const CodeItLabCredentialsModel = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  version: Schema.String,
  /** Size of the weights file in bytes; the tiny model is a few hundred kilobytes. */
  sizeBytes: Schema.Number,
  state: CodeItLabCredentialsModelState,
  /** Local path when a downloaded copy is in use. */
  path: Schema.optional(Schema.String),
  sha256: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
});
export type CodeItLabCredentialsModel = typeof CodeItLabCredentialsModel.Type;

export const CodeItLabCredentialsFindingKind = Schema.Literals([
  "api-key",
  "password",
  "token",
  "private-key",
  "jwt",
  "connection-string",
  "email",
  "phone",
  "iban",
  "card",
  "ip",
  "private-block",
  "model-detected",
]);
export type CodeItLabCredentialsFindingKind = typeof CodeItLabCredentialsFindingKind.Type;

/** Where a finding came from: a pattern, the local model, or a `/private` tag. */
export const CodeItLabCredentialsFindingSource = Schema.Literals(["pattern", "model", "tag"]);
export type CodeItLabCredentialsFindingSource = typeof CodeItLabCredentialsFindingSource.Type;

/**
 * A finding carries the span and the kind, never the value: this shape is safe
 * to show in the UI, send to the renderer and keep in the audit trail.
 */
export const CodeItLabCredentialsFinding = Schema.Struct({
  kind: CodeItLabCredentialsFindingKind,
  source: CodeItLabCredentialsFindingSource,
  start: Schema.Number,
  end: Schema.Number,
});
export type CodeItLabCredentialsFinding = typeof CodeItLabCredentialsFinding.Type;

export const CodeItLabCredentialsScanInput = Schema.Struct({
  text: Schema.String,
  /** Override the configured mode for a preview scan. */
  mode: Schema.optional(CodeItLabCredentialsMode),
  /** Where this text came from, for the audit trail (e.g. `prompt`, `tool-output`). */
  target: Schema.optional(Schema.String),
});
export type CodeItLabCredentialsScanInput = typeof CodeItLabCredentialsScanInput.Type;

export const CodeItLabCredentialsScanResult = Schema.Struct({
  /** The text as it would leave the machine. Never contains a real secret. */
  masked: Schema.String,
  findings: Schema.Array(CodeItLabCredentialsFinding).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /** True when a `/private` block made the request non-sendable under `block`. */
  blocked: BooleanDefault(false),
  privateBlocks: NumberDefault(0),
  /** True when the local model (not only patterns) contributed to the result. */
  modelUsed: BooleanDefault(false),
  detail: Schema.optional(Schema.String),
});
export type CodeItLabCredentialsScanResult = typeof CodeItLabCredentialsScanResult.Type;

export const CodeItLabCredentialsRestoreInput = Schema.Struct({
  text: Schema.String,
});
export type CodeItLabCredentialsRestoreInput = typeof CodeItLabCredentialsRestoreInput.Type;

export const CodeItLabCredentialsRestoreResult = Schema.Struct({
  /** The text with every known fake replaced by its original value. */
  text: Schema.String,
  /** How many fakes were restored. */
  restored: NumberDefault(0),
});
export type CodeItLabCredentialsRestoreResult = typeof CodeItLabCredentialsRestoreResult.Type;

export const CodeItLabCredentialsAuditEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  target: Schema.String,
  findings: Schema.Number,
  kinds: Schema.Array(CodeItLabCredentialsFindingKind).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  blocked: BooleanDefault(false),
});
export type CodeItLabCredentialsAuditEntry = typeof CodeItLabCredentialsAuditEntry.Type;

export const CodeItLabCredentialsStatus = Schema.Struct({
  enabled: BooleanDefault(false),
  /** The local gateway is listening. */
  running: BooleanDefault(false),
  port: NumberDefault(CREDENTIALS_PROXY_DEFAULT_PORT),
  /** Ready-to-copy base URL, e.g. `http://127.0.0.1:5284/v1`. */
  gatewayUrl: Schema.String,
  mode: CodeItLabCredentialsMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("balanced" as const)),
  ),
  privateTag: CodeItLabPrivateTagBehavior.pipe(
    Schema.withDecodingDefault(Effect.succeed("mask" as const)),
  ),
  model: CodeItLabCredentialsModel,
  /** Lifetime counters; values are never counted or stored. */
  scanned: NumberDefault(0),
  maskedValues: NumberDefault(0),
  blocked: NumberDefault(0),
  lastActivityAt: Schema.optional(Schema.String),
  audit: Schema.Array(CodeItLabCredentialsAuditEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  detail: Schema.optional(Schema.String),
});
export type CodeItLabCredentialsStatus = typeof CodeItLabCredentialsStatus.Type;

export const CodeItLabCredentialsUpdateInput = Schema.Struct({
  settings: CodeItLabCredentialsSettings,
});
export type CodeItLabCredentialsUpdateInput = typeof CodeItLabCredentialsUpdateInput.Type;

/** Human-readable labels for the settings page and the audit list. */
export const CREDENTIALS_FINDING_LABELS: Record<CodeItLabCredentialsFindingKind, string> = {
  "api-key": "API key",
  password: "Password",
  token: "Token",
  "private-key": "Private key",
  jwt: "JWT",
  "connection-string": "Connection string",
  email: "Email address",
  phone: "Phone number",
  iban: "IBAN",
  card: "Card number",
  ip: "Private IP address",
  "private-block": "/private block",
  "model-detected": "Local model match",
};

export const CREDENTIALS_MODE_LABELS: Record<CodeItLabCredentialsMode, string> = {
  secrets: "Secrets only",
  balanced: "Balanced",
  max: "Maximum",
};

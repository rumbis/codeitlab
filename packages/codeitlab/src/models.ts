import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Model inventory, subscription quota and custom OpenAI-compatible endpoints.
 *
 * CodeItLab talks to harnesses that own their own model lists (Claude, Codex,
 * Cursor, Grok, OpenCode, Antigravity, ACP agents), so "which models exist" is
 * spread across provider snapshots, a bundled manifest and — increasingly —
 * gateways that advertise models over HTTP. This module owns the parts that are
 * the same everywhere: an endpoint the user added by hand, the URL and payload
 * rules for talking to it, and which models the picker is allowed to hide.
 *
 * It is deliberately free of provider contracts: the server and the web app each
 * fold their own snapshots into these shapes.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const StringArrayDefault = (value: ReadonlyArray<string>) =>
  Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([...value])));

/**
 * A gateway can advertise thousands of models (aggregators routinely do), and
 * every one of them ends up in a picker row, so the list is capped rather than
 * trusted to be small.
 */
export const MODEL_ENDPOINT_MODEL_LIMIT = 2_000;

/**
 * One OpenAI-compatible endpoint added by the user.
 *
 * `apiKeyEnv` names an environment variable instead of carrying the key: the
 * settings file is a plain JSON document on disk, so a key written here would be
 * a key committed to a backup. The Models page shows the variable name, never a
 * value.
 */
export const CodeItLabModelEndpoint = Schema.Struct({
  /** Stable slug; also the React key and the settings map key. */
  id: TrimmedDefault(""),
  label: TrimmedDefault(""),
  /** OpenAI-compatible base URL, for example `https://api.example.com/v1`. */
  baseUrl: TrimmedDefault(""),
  /** Environment variable that holds the bearer token; empty means no key. */
  apiKeyEnv: TrimmedDefault(""),
  /** Model ids the endpoint serves; empty means "discover them from GET /models". */
  models: StringArrayDefault([]),
  enabled: BooleanDefault(true),
  /**
   * Mask prompts through the local credentials firewall before this endpoint
   * sees them. Endpoints are third parties the user chose, not the harness the
   * app was set up around, so the safe default is on and the row says so.
   */
  maskPrompts: BooleanDefault(true),
});
export type CodeItLabModelEndpoint = typeof CodeItLabModelEndpoint.Type;

/**
 * Only the endpoints live here. Which models a provider's picker hides is
 * already stored per instance in `clientSettings.providerModelPreferences`, and
 * a second list would let the Models page and the picker disagree about what is
 * visible — so the page reads and writes the one the picker actually uses.
 */
export const CodeItLabModelsSettings = Schema.Struct({
  endpoints: Schema.Array(CodeItLabModelEndpoint).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type CodeItLabModelsSettings = typeof CodeItLabModelsSettings.Type;

export type ModelEndpointValidation =
  | { readonly ok: true; readonly baseUrl: string }
  | { readonly ok: false; readonly reason: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * Loopback and RFC 1918 targets are the normal case for a local gateway
 * (LM Studio, Ollama, LiteLLM on the LAN), and they cannot present a public
 * certificate, so plain HTTP is allowed there. Anything else has to be HTTPS:
 * the bearer token rides on every request.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost")) return true;
  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false;
  const [first, second] = octets.map((octet) => Number.parseInt(octet, 10)) as [
    number,
    number,
    number,
    number,
  ];
  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;
  return false;
}

/**
 * Accepts what a person pastes into a base-URL field and returns the canonical
 * form, or the sentence the field should show instead of saving something that
 * will fail at request time. Trailing slashes are dropped so joining a path is
 * unambiguous.
 */
export function normalizeModelEndpointBaseUrl(raw: string): ModelEndpointValidation {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return {
      ok: false,
      reason: "Enter the base URL, for example https://api.example.com/v1.",
    };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That is not a URL. Include the scheme, for example https://." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only http and https endpoints are supported." };
  }
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      reason: "Remove the credentials from the URL; put the key in the environment variable.",
    };
  }
  if (url.search !== "" || url.hash !== "") {
    return { ok: false, reason: "A base URL cannot carry a query or a fragment." };
  }
  if (url.protocol === "http:" && !isPrivateHost(url.hostname)) {
    return {
      ok: false,
      reason:
        "Use https for a public endpoint; plain http is only allowed on this machine or the LAN.",
    };
  }
  const path = url.pathname.replace(/\/+$/, "");
  const canonical = `${url.protocol}//${url.host}${path}`;
  return { ok: true, baseUrl: canonical };
}

/** Join a validated base URL with an OpenAI path (`models`, `chat/completions`). */
export function modelEndpointUrl(baseUrl: string, path: string): string | null {
  const validation = normalizeModelEndpointBaseUrl(baseUrl);
  if (!validation.ok) return null;
  const suffix = path.replace(/^\/+/, "");
  return suffix === "" ? validation.baseUrl : `${validation.baseUrl}/${suffix}`;
}

const modelIdOf = (value: unknown): string | null => {
  if (typeof value === "string") {
    const id = value.trim();
    return id === "" ? null : id;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of ["id", "model", "name", "slug"] as const) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return null;
};

const modelListOf = (value: unknown): ReadonlyArray<unknown> => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of ["data", "models", "result"] as const) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
};

/**
 * Reads a model list from whatever the endpoint returned: the OpenAI
 * `{ data: [{ id }] }` envelope, a bare array, or `{ models: [...] }`. Gateways
 * disagree about this, and a discovery call that throws because the shape is
 * unfamiliar would hide every model behind one vendor's quirk.
 */
export function parseModelEndpointModelIds(body: string): ReadonlyArray<string> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of modelListOf(decoded)) {
    const id = modelIdOf(entry);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MODEL_ENDPOINT_MODEL_LIMIT) break;
  }
  return ids;
}

/** Deterministic slug so re-adding the same label replaces instead of duplicating. */
export function modelEndpointSlug(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug === "" ? "endpoint" : slug;
}

/** The label a row shows: the name the user gave it, else the host it points at. */
export function modelEndpointDisplayLabel(endpoint: CodeItLabModelEndpoint): string {
  const label = endpoint.label.trim();
  if (label !== "") return label;
  const validation = normalizeModelEndpointBaseUrl(endpoint.baseUrl);
  if (validation.ok) {
    try {
      return new URL(validation.baseUrl).host;
    } catch {
      /* fall through */
    }
  }
  return "Untitled endpoint";
}

export function modelVisibilityKey(instanceId: string, model: string): string {
  return `${instanceId.trim()}::${model.trim()}`;
}

export type ModelMaskingBadge = "masked" | "raw" | "off";

/**
 * What the row can promise about a prompt on its way out. `off` is the firewall
 * being disabled globally, which outranks the per-endpoint preference: the page
 * must not claim masking that is not happening.
 */
export function modelMaskingBadge(input: {
  readonly maskPrompts: boolean;
  readonly firewallEnabled: boolean;
}): ModelMaskingBadge {
  if (!input.firewallEnabled) return "off";
  return input.maskPrompts ? "masked" : "raw";
}

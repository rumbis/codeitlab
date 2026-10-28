/**
 * Which models cost nothing, so the router can keep them in play.
 *
 * Some ACP agents run a free model next to their paid ones (Cline's rotating
 * FREE promotions, OpenCode Zen's `glm-…-free` list, Junie Lite, on-device
 * models), and some providers give a $0 plan with an included allowance. The
 * router needs both facts for different reasons:
 *
 * - a genuinely free **model** is never blocked because a *paid* model on the
 *   same provider failed or because that provider's paid quota ran out;
 * - a free **plan** still has an allowance, so the quota the provider reports
 *   stays authoritative for it — a model in that plan is free only while the
 *   allowance lasts.
 *
 * The lists below come from `docs/codeitlab/ACP-FREE-TIERS.md`, whose
 * machine-readable block is the source of truth (43 agents, verified
 * 2026-10-24). Keep them in step with that block rather than guessing here.
 */

/** Agents whose zero-cost path is a free model: the model itself costs nothing. */
const FREE_MODEL_AGENTS: ReadonlySet<string> = new Set([
  "cline",
  "junie",
  "kilo",
  "opencode",
  "opencode-v2",
  "qoder",
]);

/**
 * Agents that run the model on the user's own machine, so every model is free.
 * `sigit` downloads a GGUF model on first launch and runs it through Onde.
 */
const ON_DEVICE_FREE_AGENTS: ReadonlySet<string> = new Set(["sigit"]);

/** Agents whose $0 plan includes usage: free, but limited by the reported quota. */
const FREE_TIER_AGENTS: ReadonlySet<string> = new Set([
  "antigravity-acp",
  "codebuddy-code",
  "codex-acp",
  "cursor",
  "devin",
  "gemini",
  "github-copilot-cli",
  "grok-build",
  "junie",
  "kilo",
  "mistral-vibe",
  "qoder",
]);

/**
 * Model ids the free tier covers without saying so in the name. Anything carrying
 * a `free` marker in its id is covered by {@link FREE_MARKER_PATTERN} instead.
 */
const FREE_MODEL_PATTERNS: ReadonlyArray<RegExp> = [
  // `glm-5.3-flash-free`, `provider/model:free`, `-free`, `(free)`.
  /(^|[-_/:.( ])free([-_/:. )]|$)/i,
  // OpenCode Zen lists these two by name, without a `free` marker.
  /(^|[-_/:.( ])nemotron/i,
  /(^|[-_/:.( ])mimo/i,
];

/** Provider driver kinds that map onto the agent ids above. */
const DRIVER_KIND_AGENT_IDS: Readonly<Record<string, string>> = {
  opencode: "opencode",
  muse: "muse",
  pi: "pi",
};

export interface FreeModelIdentity {
  /** `acpRegistryAgentId` from the provider instance, when it came from the registry. */
  readonly agentId?: string | undefined;
  /** The provider driver kind, used as a fallback when there is no agent id. */
  readonly driverKind?: string | undefined;
}

const agentIdsFor = (identity: FreeModelIdentity): ReadonlyArray<string> => {
  const ids: string[] = [];
  const agentId = identity.agentId?.trim().toLowerCase();
  if (agentId !== undefined && agentId.length > 0) ids.push(agentId);
  const driverKind = identity.driverKind?.trim().toLowerCase();
  if (driverKind !== undefined && driverKind.length > 0) {
    ids.push(driverKind);
    const mapped = DRIVER_KIND_AGENT_IDS[driverKind];
    if (mapped !== undefined) ids.push(mapped);
  }
  return ids;
};

const modelHasFreeMarker = (model: string): boolean =>
  FREE_MODEL_PATTERNS.some((pattern) => pattern.test(model.trim()));

/**
 * True when calling this model costs nothing per call: the agent runs a free
 * model (or on-device models) and the model matches its free set.
 */
export const isFreeModel = (identity: FreeModelIdentity, model: string): boolean => {
  if (model.trim().length === 0) return false;
  const ids = agentIdsFor(identity);
  if (ids.some((id) => ON_DEVICE_FREE_AGENTS.has(id))) return true;
  if (!ids.some((id) => FREE_MODEL_AGENTS.has(id))) return false;
  return modelHasFreeMarker(model);
};

/**
 * True when the model is free even if the provider's paid allowance is used up.
 * A free *plan* is excluded on purpose: its allowance is what the reported quota
 * measures, so the quota stays authoritative for it.
 */
export const isQuotaExemptFreeModel = (identity: FreeModelIdentity, model: string): boolean =>
  isFreeModel(identity, model);

/** True when the provider's $0 plan includes usage, limited by its quota. */
export const hasFreeTier = (identity: FreeModelIdentity): boolean =>
  agentIdsFor(identity).some((id) => FREE_TIER_AGENTS.has(id));

import {
  modelEndpointDisplayLabel,
  modelMaskingBadge,
  modelVisibilityKey,
  type CodeItLabModelEndpoint,
  type ModelMaskingBadge,
} from "@codeitlab/core/models";
import type { RoutingCatalog, RoutingHealth } from "@codeitlab/contracts";

import { codeitlabProviderName } from "./providerLabels";
import { formatModelLatency } from "./routingHealth";

/**
 * Fold for the Models page. The page owns loading; this module owns what a row
 * means, so the honesty rules the page has to keep — advertised versus listed,
 * hidden but still answering, measured versus merely probed, masking that is
 * not running — are testable without a browser.
 */

export const HIDDEN_MODEL_REASON =
  "Hidden in the model picker. A thread that already selects it still answers.";

export const NOT_MEASURED_LABEL = "not measured";

export interface ModelInventoryRow {
  /** Visibility key (instance::model) or endpoint::model for a custom endpoint. */
  readonly key: string;
  readonly instanceId: string;
  readonly model: string;
  readonly hidden: boolean;
  /** Only provider models appear in the model picker, so only they can be hidden. */
  readonly pickable: boolean;
  readonly hiddenReason: string | null;
  /** Wall-clock latency of the one-word probe, when the model answered it. */
  readonly latencyMs: number | null;
  readonly latencyLabel: string;
  /** The probe reached the model and it failed, so its latency says nothing. */
  readonly probeFailed: boolean;
  readonly defaultModel: boolean;
}

interface InventorySourceBase {
  readonly id: string;
  readonly label: string;
  readonly providerKind: string;
  readonly available: boolean;
  /** Every model the source advertises, which can exceed what it lists. */
  readonly modelCount: number;
  readonly listedCount: number;
  readonly hiddenCount: number;
  readonly truncated: boolean;
  readonly countLabel: string;
  readonly rows: ReadonlyArray<ModelInventoryRow>;
}

export interface ProviderInventorySource extends InventorySourceBase {
  readonly kind: "provider";
}

export interface EndpointInventorySource extends InventorySourceBase {
  readonly kind: "endpoint";
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly maskPrompts: boolean;
  readonly masking: ModelMaskingBadge;
  /** Why the row has no models yet; null when it lists some. */
  readonly emptyReason: string | null;
}

export type ModelInventorySource = ProviderInventorySource | EndpointInventorySource;

export interface ModelsInventory {
  readonly sources: ReadonlyArray<ModelInventorySource>;
  readonly totalModels: number;
  readonly hiddenCount: number;
  readonly measuredCount: number;
  /** Sources whose advertised count is larger than the list they publish. */
  readonly truncatedCount: number;
}

export interface ModelsInventoryInput {
  readonly catalog: RoutingCatalog;
  readonly health: RoutingHealth;
  readonly endpoints: ReadonlyArray<CodeItLabModelEndpoint>;
  /**
   * The picker's own source of truth: clientSettings.providerModelPreferences
   * per provider instance. A second list here would let this page and the
   * picker disagree about what is visible.
   */
  readonly hiddenModelsByInstance: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly firewallEnabled: boolean;
}

/**
 * modelCount is the provider's own count of every non-legacy model, while
 * models can be a shorter probe list. Saying "N models" over the shorter list
 * would hide models the user cannot see, so the label names both numbers.
 */
function countLabelFor(listedCount: number, modelCount: number): string {
  if (modelCount > listedCount) {
    return "showing " + listedCount + " of " + modelCount + " advertised";
  }
  return listedCount === 1 ? "1 model" : listedCount + " models";
}

function providerRows(
  input: ModelsInventoryInput,
  provider: RoutingCatalog["providers"][number],
  speeds: RoutingHealth["entries"][number]["speeds"],
): ReadonlyArray<ModelInventoryRow> {
  const hiddenModels = input.hiddenModelsByInstance[provider.providerInstanceId] ?? [];
  return provider.models.map((model) => {
    const speed = speeds?.find((candidate) => candidate.model === model);
    const answered = speed !== undefined && speed.ok && Number.isFinite(speed.latencyMs);
    const hidden = hiddenModels.includes(model);
    return {
      key: modelVisibilityKey(provider.providerInstanceId, model),
      instanceId: provider.providerInstanceId,
      model,
      hidden,
      pickable: true,
      hiddenReason: hidden ? HIDDEN_MODEL_REASON : null,
      latencyMs: answered ? speed.latencyMs : null,
      latencyLabel:
        speed === undefined
          ? NOT_MEASURED_LABEL
          : answered
            ? formatModelLatency(speed.latencyMs)
            : "probe failed",
      probeFailed: speed !== undefined && !speed.ok,
      defaultModel: provider.defaultModel === model,
    };
  });
}

function endpointRows(
  input: ModelsInventoryInput,
  endpoint: CodeItLabModelEndpoint,
): ReadonlyArray<ModelInventoryRow> {
  return endpoint.models.map((model) => {
    return {
      key: modelVisibilityKey(endpoint.id, model),
      instanceId: endpoint.id,
      model,
      // The model picker only lists provider instances, so an endpoint model
      // has no visibility to toggle and can never be counted as hidden.
      hidden: false,
      pickable: false,
      hiddenReason: null,
      // Discovery lists ids; it measures nothing, so a custom endpoint never
      // pretends to have a latency the router did not observe.
      latencyMs: null,
      latencyLabel: NOT_MEASURED_LABEL,
      probeFailed: false,
      defaultModel: false,
    };
  });
}

export function buildModelsInventory(input: ModelsInventoryInput): ModelsInventory {
  const speedsByInstance = new Map(
    input.health.entries.map((entry) => [entry.providerInstanceId, entry.speeds] as const),
  );
  const providerSources = input.catalog.providers.map((provider): ProviderInventorySource => {
    const rows = providerRows(input, provider, speedsByInstance.get(provider.providerInstanceId));
    const listedCount = rows.length;
    const modelCount = provider.modelCount ?? listedCount;
    return {
      kind: "provider",
      id: provider.providerInstanceId,
      label: codeitlabProviderName(provider.name),
      providerKind: provider.providerKind,
      available: provider.available,
      modelCount,
      listedCount,
      hiddenCount: rows.filter((row) => row.pickable && row.hidden).length,
      truncated: modelCount > listedCount,
      countLabel: countLabelFor(listedCount, modelCount),
      rows,
    };
  });
  const endpointSources = input.endpoints.map((endpoint): EndpointInventorySource => {
    const rows = endpointRows(input, endpoint);
    const listedCount = rows.length;
    return {
      kind: "endpoint",
      id: endpoint.id,
      label: modelEndpointDisplayLabel(endpoint),
      providerKind: "OpenAI-compatible",
      available: endpoint.enabled,
      modelCount: listedCount,
      listedCount,
      hiddenCount: 0,
      truncated: false,
      countLabel: listedCount === 0 ? "no model ids yet" : countLabelFor(listedCount, listedCount),
      rows,
      baseUrl: endpoint.baseUrl,
      apiKeyEnv: endpoint.apiKeyEnv,
      maskPrompts: endpoint.maskPrompts,
      masking: modelMaskingBadge({
        maskPrompts: endpoint.maskPrompts,
        firewallEnabled: input.firewallEnabled,
      }),
      emptyReason:
        listedCount > 0
          ? null
          : "No model ids are saved for this endpoint. Use Fetch models to ask it, then save what it lists.",
    };
  });
  const sources: ReadonlyArray<ModelInventorySource> = [...providerSources, ...endpointSources];
  const rows = sources.flatMap((source) => source.rows);
  return {
    sources,
    totalModels: rows.length,
    hiddenCount: rows.filter((row) => row.pickable && row.hidden).length,
    measuredCount: rows.filter((row) => row.latencyMs !== null).length,
    truncatedCount: sources.filter((source) => source.truncated).length,
  };
}

// Subscription quota

export type ModelsQuotaWindowKind = "session" | "weekly" | "monthly" | "other";

export interface ModelsQuotaWindowInput {
  readonly id: string;
  readonly kind: ModelsQuotaWindowKind;
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAt: string | null;
}

export interface ModelsQuotaAccountInput {
  readonly id: string;
  readonly label: string;
  /** What the provider says about the account, not a plan this page invented. */
  readonly plan: string | null;
  readonly windows: ReadonlyArray<ModelsQuotaWindowInput>;
  readonly unavailable: {
    readonly reason: "unsupported" | "probeFailed";
    readonly message?: string | undefined;
  } | null;
  readonly connected: boolean;
  readonly error: string | null;
}

export interface ModelsQuotaWindow {
  readonly id: string;
  readonly kind: ModelsQuotaWindowKind;
  readonly label: string;
  readonly usedPercent: number;
  readonly resetLabel: string;
}

export interface ModelsQuotaAccount {
  readonly id: string;
  readonly label: string;
  readonly plan: string | null;
  readonly planLabel: string;
  readonly windows: ReadonlyArray<ModelsQuotaWindow>;
  readonly notReportedReason: string | null;
  /** The fullest window, so a list can be ordered by pressure. */
  readonly peakUsedPercent: number | null;
}

export function formatQuotaReset(resetsAt: string | null, nowMs: number): string {
  if (resetsAt === null) return "reset time not reported";
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return "reset time not reported";
  const remaining = at - nowMs;
  if (remaining <= 0) return "resets now";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return "resets in " + minutes + " min";
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest === 0 ? "resets in " + hours + " h" : "resets in " + hours + " h " + rest + " min";
  }
  return "resets in " + Math.floor(hours / 24) + " d";
}

/**
 * Why a row has no bars. The distinction matters: an API-key account can never
 * report windows, while a failed probe is worth retrying, and a disconnected
 * environment is not a provider problem at all.
 */
function quotaNotReportedReason(account: ModelsQuotaAccountInput): string | null {
  if (account.error !== null && account.error.trim() !== "") {
    return (
      "This environment could not report usage (" +
      account.error.trim() +
      "), so no quota is shown."
    );
  }
  if (!account.connected) return "The environment is not connected, so its quota is not reported.";
  if (account.unavailable !== null) {
    if (account.unavailable.reason === "unsupported") {
      return "This account signs in with an API key, so the provider cannot report usage windows.";
    }
    const detail = account.unavailable.message?.trim() ?? "";
    return detail === ""
      ? "The last quota probe failed, so no windows are reported right now."
      : "The last quota probe failed: " + detail + ".";
  }
  if (account.windows.length === 0) return "The provider reported no usage windows.";
  return null;
}

export function buildModelsQuota(input: {
  readonly accounts: ReadonlyArray<ModelsQuotaAccountInput>;
  readonly nowMs: number;
}): ReadonlyArray<ModelsQuotaAccount> {
  return input.accounts.map((account) => {
    const windows = account.windows.map((window) => ({
      id: window.id,
      kind: window.kind,
      label: window.label,
      usedPercent: window.usedPercent,
      resetLabel: formatQuotaReset(window.resetsAt, input.nowMs),
    }));
    const plan = account.plan === null || account.plan.trim() === "" ? null : account.plan.trim();
    return {
      id: account.id,
      label: account.label,
      plan,
      planLabel: plan ?? "not reported",
      windows,
      notReportedReason: quotaNotReportedReason(account),
      peakUsedPercent:
        windows.length === 0
          ? null
          : windows.reduce((peak, window) => Math.max(peak, window.usedPercent), 0),
    };
  });
}

// Privacy masking

export interface ModelsMaskingStatus {
  readonly badge: ModelMaskingBadge;
  readonly headline: string;
  readonly detail: string;
}

const MASKING_LABELS: Readonly<Record<ModelMaskingBadge, string>> = {
  masked: "Masked",
  raw: "Raw prompts",
  off: "Masking off",
};

const MASKING_VARIANTS: Readonly<Record<ModelMaskingBadge, "success" | "warning" | "secondary">> = {
  masked: "success",
  raw: "warning",
  off: "secondary",
};

export function maskingLabel(badge: ModelMaskingBadge): string {
  return MASKING_LABELS[badge];
}

export function maskingVariant(badge: ModelMaskingBadge): "success" | "warning" | "secondary" {
  return MASKING_VARIANTS[badge];
}

/**
 * The page must never promise masking it cannot see: an unreported firewall is
 * treated as off, because claiming a redaction that is not running is worse
 * than saying the status is unknown.
 */
export function summarizeMasking(input: {
  readonly firewallReported: boolean;
  readonly firewallEnabled: boolean;
  readonly endpoints: ReadonlyArray<CodeItLabModelEndpoint>;
}): ModelsMaskingStatus {
  const anyRaw = input.endpoints.some((endpoint) => !endpoint.maskPrompts);
  const badge = modelMaskingBadge({
    maskPrompts: !anyRaw,
    firewallEnabled: input.firewallReported && input.firewallEnabled,
  });
  if (!input.firewallReported) {
    return {
      badge,
      headline: "Masking status is unknown.",
      detail:
        "The credentials proxy has not reported from this environment, so this page does not claim masking. Open Privacy to check it.",
    };
  }
  if (!input.firewallEnabled) {
    return {
      badge,
      headline: "Masking is off.",
      detail:
        "The credentials firewall is disabled, so prompts leave this machine unmasked. Turn it on in Privacy before trusting a third-party endpoint.",
    };
  }
  if (anyRaw) {
    return {
      badge,
      headline: "Some prompts leave unmasked.",
      detail:
        "The firewall is on, but at least one endpoint below has masking turned off, so its prompts reach that provider as written.",
    };
  }
  return {
    badge,
    headline: "Prompts are masked before they leave this machine.",
    detail:
      "The firewall is on and every endpoint below masks prompts through it. Built-in agents use the same firewall.",
  };
}

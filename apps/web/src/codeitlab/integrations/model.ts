import type {
  CodeitlabIntegrationAction,
  CodeitlabIntegrationId,
  CodeitlabIntegrationState,
  CodeitlabIntegrationStatus,
} from "@t3tools/contracts";

/**
 * Display logic for the whitelabel integration pages. Kept pure so the state
 * language and URL normalisation can be tested without mounting the page.
 */

export const INTEGRATION_IDS: ReadonlyArray<CodeitlabIntegrationId> = ["shorts", "crew", "search"];

export const INTEGRATION_SURFACE_LABELS: Readonly<Record<CodeitlabIntegrationId, string>> = {
  shorts: "SHORTS // VERTICAL CLIPS",
  crew: "CREW // TEAMMATE BOTS",
  search: "SEARCH // WEB & X",
};

const STATE_LABELS: Readonly<Record<CodeitlabIntegrationState, string>> = {
  ready: "Ready",
  unreachable: "Unreachable",
  "not-configured": "Not configured",
  disabled: "Disabled",
};

type StateBadgeVariant = "success" | "warning" | "error" | "secondary";

const STATE_VARIANTS: Readonly<Record<CodeitlabIntegrationState, StateBadgeVariant>> = {
  ready: "success",
  unreachable: "error",
  "not-configured": "warning",
  disabled: "secondary",
};

export function integrationStateLabel(state: CodeitlabIntegrationState): string {
  return STATE_LABELS[state];
}

export function integrationStateVariant(state: CodeitlabIntegrationState): StateBadgeVariant {
  return STATE_VARIANTS[state];
}

export function formatIntegrationLatency(latencyMs: number | undefined): string | null {
  if (latencyMs === undefined || !Number.isFinite(latencyMs) || latencyMs < 0) return null;
  return `${Math.round(latencyMs)} ms`;
}

/**
 * The server accepts a plain URL; users type `localhost:8000` or leave a
 * trailing slash. Normalise to `http(s)://host[:port][/path]` without adding a
 * path of our own. An empty input is meaningful: it clears the override.
 */
export function normalizeBaseUrlInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

export function findIntegration(
  integrations: ReadonlyArray<CodeitlabIntegrationStatus>,
  id: CodeitlabIntegrationId,
): CodeitlabIntegrationStatus | null {
  return integrations.find((integration) => integration.id === id) ?? null;
}

export function findIntegrationAction(
  actions: ReadonlyArray<CodeitlabIntegrationAction>,
  id: string,
): CodeitlabIntegrationAction | null {
  return actions.find((action) => action.id === id) ?? null;
}

/** Commands the page can show: install first, then copy-style instructions. */
export function findSetupCommand(
  actions: ReadonlyArray<CodeitlabIntegrationAction>,
): CodeitlabIntegrationAction | null {
  return (
    actions.find((action) => action.kind === "install") ??
    actions.find((action) => action.kind === "copy") ??
    null
  );
}

export function wiredChipVariant(entry: string): "info" | "secondary" {
  return entry.startsWith("mcp") ? "info" : "secondary";
}

export function integrationWiredCount(wired: {
  readonly mcpServers: ReadonlyArray<string>;
  readonly skills: ReadonlyArray<string>;
}): number {
  return wired.mcpServers.length + wired.skills.length;
}

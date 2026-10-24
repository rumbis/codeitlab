import {
  ProviderInstanceId,
  ProviderDriverKind,
  type AcpRegistrySearchAgent,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import {
  FREEMIUM_AGENTS,
  PREMIUM_AGENTS,
  type FreemiumAgent,
  type PremiumAgent,
} from "./freemiumAgents";

/** Post-install state of the provider instance behind an agent card. */
export type AgentHealth = "ready" | "sign-in" | "attention" | "disabled";

export interface AgentHealthFields {
  readonly health: AgentHealth | null;
  readonly healthMessage: string | null;
}

export interface FreemiumAgentCard extends FreemiumAgent, AgentHealthFields {
  readonly version: string | null;
  readonly icon: string | null;
  readonly installed: boolean;
  readonly instanceId: string | null;
  readonly installing: boolean;
}

export interface PremiumAgentCard extends Omit<PremiumAgent, "docsUrl">, AgentHealthFields {
  readonly version: string | null;
  readonly icon: string | null;
  /** Curated docs page, else the registry's website or repository. */
  readonly docsUrl: string | null;
  readonly installed: boolean;
  readonly instanceId: string | null;
  readonly installing: boolean;
}

/** Any other registry agent: installable, but not vouched as free to start. */
export interface RegistryAgentCard extends AgentHealthFields {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly version: string | null;
  readonly icon: string | null;
  readonly docsUrl: string | null;
  readonly installed: boolean;
  readonly instanceId: string | null;
  readonly installing: boolean;
}

export function agentHealth(provider: ServerProvider | undefined): AgentHealth | null {
  if (provider === undefined) return null;
  if (!provider.enabled || provider.status === "disabled") return "disabled";
  if (!provider.installed) return "attention";
  // A pending URL-auth elicitation (or a plain unauthenticated state) is the
  // actionable case: the user has to finish sign-in before the agent can run.
  if (provider.auth.action !== undefined || provider.auth.status === "unauthenticated") {
    return "sign-in";
  }
  // Some agents only explain the sign-in step in the status message.
  if (provider.message !== undefined && /sign[ -]?in/i.test(provider.message)) {
    return "sign-in";
  }
  if (provider.status === "error" || provider.status === "warning") return "attention";
  return "ready";
}

function healthFields(
  instanceId: string | null,
  providers: ReadonlyMap<string, ServerProvider> | null,
): AgentHealthFields {
  const provider = instanceId === null ? undefined : providers?.get(instanceId);
  return {
    health: provider === undefined ? null : agentHealth(provider),
    healthMessage: provider?.message ?? null,
  };
}

/**
 * A registry-backed ACP instance stores the agent id in its config. Older
 * instances predate the `source` field, so a missing source still counts as a
 * registry instance when the id is present.
 */
export function installedFreemiumAgents(
  instances: Readonly<Record<string, ProviderInstanceConfig>> | null | undefined,
): ReadonlyMap<string, string> {
  const installed = new Map<string, string>();
  for (const [instanceId, instance] of Object.entries(instances ?? {})) {
    if (instance.driver !== "acpRegistry") continue;
    const config = instance.config;
    if (typeof config !== "object" || config === null) continue;
    const record = config as { readonly source?: unknown; readonly agentId?: unknown };
    if (record.source !== undefined && record.source !== "registry") continue;
    if (typeof record.agentId !== "string" || record.agentId.length === 0) continue;
    if (!installed.has(record.agentId)) installed.set(record.agentId, instanceId);
  }
  return installed;
}

/** Instance ids are slugs; keep the agent id readable but unique. */
export function deriveFreemiumInstanceId(
  agentId: string,
  existingIds: ReadonlySet<string>,
): ProviderInstanceId {
  const slug =
    agentId
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 48) || "agent";
  const base = `acpRegistry_${slug}`.slice(0, 64);
  if (!existingIds.has(base)) return ProviderInstanceId.make(base);
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const candidate = `${base.slice(0, 60)}_${suffix}`;
    if (!existingIds.has(candidate)) return ProviderInstanceId.make(candidate);
  }
  return ProviderInstanceId.make(`acpRegistry_${Date.now().toString(36)}`);
}

export function mergeFreemiumCards(input: {
  readonly registry: ReadonlyArray<AcpRegistrySearchAgent> | null;
  readonly installed: ReadonlyMap<string, string>;
  readonly installingId: string | null;
  readonly iconFor: (agentId: string) => string | null;
  readonly providers: ReadonlyMap<string, ServerProvider> | null;
}): ReadonlyArray<FreemiumAgentCard> {
  const registryById = new Map((input.registry ?? []).map((agent) => [agent.id, agent]));
  return FREEMIUM_AGENTS.map((agent) => {
    const registryAgent = registryById.get(agent.id);
    const installedInstanceId = input.installed.get(agent.id) ?? null;
    return {
      ...agent,
      ...healthFields(installedInstanceId, input.providers),
      name: registryAgent?.name ?? agent.name,
      summary:
        registryAgent?.description.trim() && registryAgent.description.trim().length > 0
          ? registryAgent.description.trim()
          : agent.summary,
      version: registryAgent?.version ?? null,
      icon: registryAgent?.icon ?? input.iconFor(agent.id),
      installed: installedInstanceId !== null,
      instanceId: installedInstanceId,
      installing: input.installingId === agent.id,
    };
  });
}

export function mergePremiumCards(input: {
  readonly registry: ReadonlyArray<AcpRegistrySearchAgent> | null;
  readonly installed: ReadonlyMap<string, string>;
  readonly installingId: string | null;
  readonly iconFor: (agentId: string) => string | null;
  readonly providers: ReadonlyMap<string, ServerProvider> | null;
}): ReadonlyArray<PremiumAgentCard> {
  const registryById = new Map((input.registry ?? []).map((agent) => [agent.id, agent]));
  return PREMIUM_AGENTS.map((agent) => {
    const registryAgent = registryById.get(agent.id);
    const installedInstanceId = input.installed.get(agent.id) ?? null;
    return {
      ...agent,
      ...healthFields(installedInstanceId, input.providers),
      name: registryAgent?.name ?? agent.name,
      summary:
        registryAgent?.description.trim() && registryAgent.description.trim().length > 0
          ? registryAgent.description.trim()
          : agent.summary,
      version: registryAgent?.version ?? null,
      icon: registryAgent?.icon ?? input.iconFor(agent.id),
      docsUrl: agent.docsUrl ?? registryAgent?.website ?? registryAgent?.repository ?? null,
      installed: installedInstanceId !== null,
      instanceId: installedInstanceId,
      installing: input.installingId === agent.id,
    };
  });
}

export type FreemiumInstallOutcome =
  | { readonly ok: true; readonly instanceId: ProviderInstanceId }
  | { readonly ok: false; readonly message: string };

export interface FreemiumInstallDeps {
  readonly agent: { readonly id: string; readonly name: string };
  readonly existingIds: ReadonlySet<string>;
  /** `server.prepareAcpRegistryAgent`, already bound to the environment. */
  readonly prepare: (agentId: string) => Promise<AtomCommandResult<unknown, unknown>>;
  /** `provider.mutateProviderInstance` create, already bound to the environment. */
  readonly createInstance: (
    instanceId: ProviderInstanceId,
    instance: ProviderInstanceConfig,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}

function failureMessage(result: AtomCommandResult<unknown, unknown>): string {
  if (result._tag !== "Failure") return "The install failed.";
  if (isAtomCommandInterrupted(result)) return "The install was interrupted.";
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The install failed.";
}

const ACP_REGISTRY_DRIVER = ProviderDriverKind.make("acpRegistry");

/**
 * The install is two RPCs on purpose: the managed download can fail on its own
 * (offline, unsupported platform) and a half-created provider instance would
 * then point at a missing executable.
 */
export async function installFreemiumAgent(
  deps: FreemiumInstallDeps,
): Promise<FreemiumInstallOutcome> {
  const prepared = await deps.prepare(deps.agent.id);
  if (prepared._tag !== "Success") {
    return { ok: false, message: failureMessage(prepared) };
  }
  const instanceId = deriveFreemiumInstanceId(deps.agent.id, deps.existingIds);
  const instance: ProviderInstanceConfig = {
    driver: ACP_REGISTRY_DRIVER,
    enabled: true,
    displayName: deps.agent.name,
    config: { source: "registry", agentId: deps.agent.id, distribution: "auto" },
  };
  const created = await deps.createInstance(instanceId, instance);
  if (created._tag !== "Success") {
    return { ok: false, message: failureMessage(created) };
  }
  return { ok: true, instanceId };
}

export function mergeOtherAgentCards(input: {
  readonly registry: ReadonlyArray<AcpRegistrySearchAgent> | null;
  readonly installed: ReadonlyMap<string, string>;
  readonly installingId: string | null;
  readonly providers: ReadonlyMap<string, ServerProvider> | null;
}): ReadonlyArray<RegistryAgentCard> {
  const curated = new Set([
    ...FREEMIUM_AGENTS.map((agent) => agent.id),
    ...PREMIUM_AGENTS.map((agent) => agent.id),
  ]);
  return (input.registry ?? [])
    .filter((agent) => !curated.has(agent.id))
    .map((agent) => {
      const instanceId = input.installed.get(agent.id) ?? null;
      return {
        ...healthFields(instanceId, input.providers),
        id: agent.id,
        name: agent.name,
        summary: agent.description.trim(),
        version: agent.version,
        icon: agent.icon,
        docsUrl: agent.website ?? agent.repository,
        installed: instanceId !== null,
        instanceId,
        installing: input.installingId === agent.id,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

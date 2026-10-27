import { useAtomValue } from "@effect/atom-react";
import {
  ACP_REGISTRY_MAX_AGENTS,
  AuthProvidersManageScope,
  ProviderInstanceId,
  officialAcpRegistryIconUrlForAgentId,
  resolveProviderInstanceEnabled,
  type ServerProvider,
  type ServerSettings,
} from "@codeitlab/contracts";
import { Atom } from "effect/reactivity";
import { useState } from "react";

import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import {
  installFreemiumAgent,
  installedFreemiumAgents,
  mergeFreemiumCards,
  mergeOtherAgentCards,
  mergePremiumCards,
  type FreemiumAgentCard,
  type FreemiumInstallOutcome,
  type PremiumAgentCard,
  type RegistryAgentCard,
} from "./agents.logic";
import { FREEMIUM_AGENTS, PREMIUM_AGENTS } from "./freemiumAgents";

const NO_SETTINGS_ATOM = Atom.make<ServerSettings | null>(null);
const NO_PROVIDERS_ATOM = Atom.make<ReadonlyArray<ServerProvider> | null>(null);

export type { FreemiumInstallOutcome } from "./agents.logic";

export interface DisablePremiumAgentsOutcome {
  readonly ok: boolean;
  readonly disabled: number;
  readonly message?: string;
}

export interface CodeItLabAgentsView {
  readonly agents: ReadonlyArray<FreemiumAgentCard>;
  readonly premiumAgents: ReadonlyArray<PremiumAgentCard>;
  readonly otherAgents: ReadonlyArray<RegistryAgentCard>;
  /** Enabled provider instances whose registry agent has no free tier. */
  readonly premiumInstanceCount: number;
  readonly installedCount: number;
  readonly canInstall: boolean;
  readonly source: "server" | "local";
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
  readonly install: (agentId: string) => Promise<FreemiumInstallOutcome>;
  /** Free-only mode: turn off every provider instance without a free tier. */
  readonly disablePremiumAgents: () => Promise<DisablePremiumAgentsOutcome>;
}

/**
 * Curated free ACP agents merged with the live registry, plus a one-click
 * install that runs the same managed download as the ACP provider wizard and
 * then creates an enabled provider instance for the agent.
 */
export function useCodeItLabAgents(): CodeItLabAgentsView {
  const environmentId = usePrimaryEnvironmentId();
  const settings = useAtomValue(
    environmentId === null ? NO_SETTINGS_ATOM : serverEnvironment.settingsValueAtom(environmentId),
  );
  const providers = useAtomValue(
    environmentId === null
      ? NO_PROVIDERS_ATOM
      : serverEnvironment.providersValueAtom(environmentId),
  );
  const search = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.searchAcpRegistry({
          environmentId,
          input: { query: "", limit: ACP_REGISTRY_MAX_AGENTS },
        }),
  );
  const prepare = useAtomCommand(serverEnvironment.prepareAcpRegistryAgent, {
    reportFailure: false,
  });
  const mutateProviderInstance = useAtomCommand(serverEnvironment.mutateProviderInstance, {
    reportFailure: false,
  });
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const installed = installedFreemiumAgents(settings?.providerInstances);
  const providerByInstance = new Map(
    (providers ?? []).map((provider) => [String(provider.instanceId), provider] as const),
  );
  const agents = mergeFreemiumCards({
    registry: search.data?.agents ?? null,
    installed,
    installingId,
    iconFor: officialAcpRegistryIconUrlForAgentId,
    providers: providerByInstance,
  });
  const premiumAgents = mergePremiumCards({
    registry: search.data?.agents ?? null,
    installed,
    installingId,
    iconFor: officialAcpRegistryIconUrlForAgentId,
    providers: providerByInstance,
  });
  const otherAgents = mergeOtherAgentCards({
    registry: search.data?.agents ?? null,
    installed,
    installingId,
    providers: providerByInstance,
  });
  const providerInstances = settings?.providerInstances;
  const knownInstanceIds = new Set<string>([
    "codex",
    "claudeAgent",
    ...Object.keys(providerInstances ?? {}),
  ]);
  const freeAgentIds = new Set(FREEMIUM_AGENTS.map((agent) => agent.id));
  const premiumInstances = Object.entries(providerInstances ?? {}).flatMap(
    ([instanceId, instance]) => {
      if (instance.driver !== "acpRegistry") return [];
      const config = instance.config;
      if (config === null || typeof config !== "object") return [];
      const source = (config as { readonly source?: unknown }).source;
      if (source === "local") return [];
      const agentId = (config as { readonly agentId?: unknown }).agentId;
      // Anything without a free tier is turned off by free-only mode; using the
      // free list (not the curated premium list) keeps future registry agents
      // covered without another edit.
      if (typeof agentId !== "string" || freeAgentIds.has(agentId)) return [];
      return [
        {
          instanceId: ProviderInstanceId.make(instanceId),
          instance,
          enabled: resolveProviderInstanceEnabled(instance),
        },
      ];
    },
  );
  const premiumInstanceCount = premiumInstances.filter((entry) => entry.enabled).length;

  const install = async (agentId: string): Promise<FreemiumInstallOutcome> => {
    if (environmentId === null) {
      return { ok: false, message: "Connect an environment to install an agent." };
    }
    if (!canManageProviders) {
      return { ok: false, message: "This environment does not allow provider changes." };
    }
    if (installingId !== null) {
      return { ok: false, message: "Another agent install is already running." };
    }
    const agent =
      agents.find((candidate) => candidate.id === agentId) ??
      premiumAgents.find((candidate) => candidate.id === agentId) ??
      otherAgents.find((candidate) => candidate.id === agentId);
    if (agent === undefined) {
      return { ok: false, message: "Unknown agent." };
    }
    setInstallingId(agentId);
    const outcome = await installFreemiumAgent({
      agent,
      existingIds: knownInstanceIds,
      prepare: (targetAgentId) => prepare({ environmentId, input: { agentId: targetAgentId } }),
      createInstance: (instanceId, instance) =>
        mutateProviderInstance({
          environmentId,
          input: {
            patch: {},
            providerInstanceMutation: { operation: "create", instanceId, instance },
          },
        }),
    });
    setInstallingId(null);
    return outcome;
  };

  const disablePremiumAgents = async (): Promise<DisablePremiumAgentsOutcome> => {
    if (environmentId === null) {
      return { ok: false, disabled: 0, message: "Connect an environment to change providers." };
    }
    if (!canManageProviders) {
      return {
        ok: false,
        disabled: 0,
        message: "This environment does not allow provider changes.",
      };
    }
    let disabled = 0;
    for (const entry of premiumInstances) {
      if (!entry.enabled) continue;
      const result = await mutateProviderInstance({
        environmentId,
        input: {
          patch: {},
          providerInstanceMutation: {
            operation: "upsert",
            instanceId: entry.instanceId,
            instance: { ...entry.instance, enabled: false },
          },
        },
      });
      if (result._tag === "Failure") {
        return {
          ok: false,
          disabled,
          message: "The settings update failed; some providers may still be enabled.",
        };
      }
      disabled += 1;
    }
    return { ok: true, disabled };
  };

  const error = search.error;
  const source: "server" | "local" =
    environmentId === null || search.data === null ? "local" : "server";
  return {
    agents,
    premiumAgents,
    otherAgents,
    premiumInstanceCount,
    installedCount: installed.size,
    canInstall: environmentId !== null && canManageProviders,
    source,
    error,
    isPending: search.isPending,
    refresh: search.refresh,
    install,
    disablePremiumAgents,
  };
}

export { FREEMIUM_AGENTS, PREMIUM_AGENTS };
export type { FreemiumAgentCard, PremiumAgentCard, RegistryAgentCard } from "./agents.logic";
export type { FreemiumAgent } from "./freemiumAgents";

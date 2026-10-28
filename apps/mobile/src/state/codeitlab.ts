import { createEnvironmentRpcQueryAtomFamily } from "@codeitlab/client-runtime/state/runtime";
import { WS_METHODS } from "@codeitlab/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/**
 * Read-only CodeItLab status queries for the mobile status screen. These are the
 * same environment RPC methods the web panel uses; mobile only reads them, so
 * there are no commands here.
 */
export const codeitlabNexusCatalogQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "mobile-codeitlab:nexus:catalog",
    tag: WS_METHODS.codeitlabNexusCatalog,
    staleTimeMs: 30_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabMemoryStatsQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "mobile-codeitlab:memory:stats",
    tag: WS_METHODS.codeitlabMemoryStats,
    staleTimeMs: 30_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabRoutingCatalogQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "mobile-codeitlab:routing:catalog",
    tag: WS_METHODS.codeitlabRoutingCatalog,
    staleTimeMs: 30_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabPolicyEffectiveQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "mobile-codeitlab:policy:effective",
    tag: WS_METHODS.codeitlabPolicyEffective,
    staleTimeMs: 30_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabReaStatusQuery = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "mobile-codeitlab:rea:status",
  tag: WS_METHODS.codeitlabReaStatus,
  staleTimeMs: 30_000,
  idleTtlMs: 120_000,
});

export const codeitlabEcosystemStatusQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "mobile-codeitlab:ecosystem:status",
    tag: WS_METHODS.codeitlabEcosystemStatus,
    staleTimeMs: 30_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabIntegrationsListQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "mobile-codeitlab:integrations:list",
    tag: WS_METHODS.codeitlabIntegrationsList,
    staleTimeMs: 30_000,
    idleTtlMs: 120_000,
  },
);

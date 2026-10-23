import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { CodeitlabServiceError } from "./errors.ts";

import type { CodeitlabEcosystemInstallResult, CodeitlabEcosystemStatus } from "./ecosystem.ts";

export type {
  CodeitlabEcosystemInstallResult,
  CodeitlabEcosystemIntegration,
  CodeitlabEcosystemStatus,
} from "./ecosystem.ts";
export type {
  StudioExportResult,
  StudioProject,
  StudioProjectInput,
  StudioSlide,
} from "./studio.ts";
export type {
  CodeitlabRemotePairingLink,
  CodeitlabRemoteStatus,
  CodeitlabRemoteServer,
  CodeitlabRemoteTailnet,
} from "./remote.ts";
export type {
  CodeitlabIntegrationAction,
  CodeitlabIntegrationConfig,
  CodeitlabIntegrationId,
  CodeitlabIntegrationList,
  CodeitlabIntegrationPatch,
  CodeitlabIntegrationState,
  CodeitlabIntegrationStatus,
  CodeitlabIntegrationsSettings,
  CodeitlabShortsClip,
  CodeitlabShortsJob,
  CodeitlabShortsJobCreated,
  CodeitlabShortsJobRequest,
  CodeitlabShortsJobState,
} from "./integrations.ts";
import type {
  CodeitlabShortsJob,
  CodeitlabShortsJobCreated,
  CodeitlabShortsJobRequest,
} from "./integrations.ts";
import type { StudioExportResult, StudioProject, StudioProjectInput } from "./studio.ts";
import type { CodeitlabRemotePairingLink, CodeitlabRemoteStatus } from "./remote.ts";
import type { CodeitlabIntegrationList, CodeitlabIntegrationPatch } from "./integrations.ts";
import type {
  CodeitlabCredentialsModel,
  CodeitlabCredentialsRestoreInput,
  CodeitlabCredentialsRestoreResult,
  CodeitlabCredentialsScanInput,
  CodeitlabCredentialsScanResult,
  CodeitlabCredentialsSettings,
  CodeitlabCredentialsStatus,
} from "./credentials.ts";
import type {
  MemoryEntry,
  MemoryRecall,
  MemorySearchInput,
  MemorySearchHit,
  MemoryStats,
} from "./memory.ts";
import type { NexusCatalog } from "./nexus.ts";
import type { EffectivePolicy, PolicyAuditEntry, PolicyProfile } from "./policy.ts";
import type { ReaCapability, ReaStatus } from "./rea.ts";
import type {
  RoutingCatalog,
  RoutingDecideInput,
  RoutingDecision,
  RoutingHealth,
} from "./routing.ts";

/**
 * Service tags shared by the server features. The server owns the live
 * implementations; transports (ws RPC, MCP tools, CLI) only decode input and
 * call one method.
 */

export interface CodeitlabTurnContextInput {
  readonly threadId?: string;
  readonly projectId?: string | null;
  readonly prompt: string;
  readonly providerInstanceId?: string;
  readonly attachments?: ReadonlyArray<string>;
  /**
   * Per-thread override for the ecosystem policy packs. `off` disables the
   * Ponytail/terse instructions for this turn; the turn hook persists the value
   * when the user says "normal mode" or "stop caveman".
   */
  readonly threadOverride?: "off" | "on";
}

export interface CodeitlabTurnContext {
  /** Instruction block appended to the provider turn, already policy-scoped. */
  readonly instructions: string;
  readonly recall?: MemoryRecall;
  readonly decision?: RoutingDecision;
  readonly policy: EffectivePolicy;
  readonly nexus?: Pick<NexusCatalog, "skills" | "mcpServers">;
}

export class EcosystemService extends Context.Service<
  EcosystemService,
  {
    readonly status: Effect.Effect<CodeitlabEcosystemStatus, CodeitlabServiceError>;
    readonly install: Effect.Effect<CodeitlabEcosystemInstallResult, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/EcosystemService") {}

/**
 * Decks and video scenes. The renderer is shared with the clients, so the
 * service only owns persistence and export — it never formats HTML itself.
 */
export class StudioService extends Context.Service<
  StudioService,
  {
    readonly list: Effect.Effect<ReadonlyArray<StudioProject>, CodeitlabServiceError>;
    readonly save: (
      input: StudioProjectInput,
    ) => Effect.Effect<StudioProject, CodeitlabServiceError>;
    readonly remove: (id: string) => Effect.Effect<boolean, CodeitlabServiceError>;
    readonly exportHtml: (id: string) => Effect.Effect<StudioExportResult, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/StudioService") {}

/**
 * Remote access over the network the user already owns: tailnet/LAN status and
 * one-time pairing links for phones.
 */
export class RemoteService extends Context.Service<
  RemoteService,
  {
    readonly status: Effect.Effect<CodeitlabRemoteStatus, CodeitlabServiceError>;
    readonly createPairingLink: Effect.Effect<CodeitlabRemotePairingLink, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/RemoteService") {}

/**
 * Whitelabel integrations: configure, probe, and agent-wire the self-hostable
 * engines behind the Shorts, Crew and Search surfaces.
 */
export class IntegrationsService extends Context.Service<
  IntegrationsService,
  {
    readonly list: Effect.Effect<CodeitlabIntegrationList, CodeitlabServiceError>;
    readonly set: (
      patch: CodeitlabIntegrationPatch,
    ) => Effect.Effect<CodeitlabIntegrationList, CodeitlabServiceError>;
    /** Submit a Shorts clip job to the configured engine. */
    readonly createShortsJob: (
      request: CodeitlabShortsJobRequest,
    ) => Effect.Effect<CodeitlabShortsJobCreated, CodeitlabServiceError>;
    /** Poll a Shorts clip job and normalise the engine response. */
    readonly shortsJobStatus: (
      jobId: string,
    ) => Effect.Effect<CodeitlabShortsJob, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/IntegrationsService") {}

export type {
  CodeitlabCredentialsModel,
  CodeitlabCredentialsRestoreInput,
  CodeitlabCredentialsRestoreResult,
  CodeitlabCredentialsScanInput,
  CodeitlabCredentialsScanResult,
  CodeitlabCredentialsSettings,
  CodeitlabCredentialsStatus,
} from "./credentials.ts";

/**
 * The local credentials proxy: detects secrets in outbound text, replaces them
 * with format-preserving fakes, restores the real values on the way back, and
 * runs the optional local gateway the provider base URLs can point at.
 */
export class CredentialsService extends Context.Service<
  CredentialsService,
  {
    readonly status: Effect.Effect<CodeitlabCredentialsStatus, CodeitlabServiceError>;
    readonly update: (
      settings: CodeitlabCredentialsSettings,
    ) => Effect.Effect<CodeitlabCredentialsStatus, CodeitlabServiceError>;
    /** Preview scan: returns the masked text and value-free findings. */
    readonly scan: (
      input: CodeitlabCredentialsScanInput,
    ) => Effect.Effect<CodeitlabCredentialsScanResult, CodeitlabServiceError>;
    /** Put the real values back into a response or tool output. */
    readonly restore: (
      input: CodeitlabCredentialsRestoreInput,
    ) => Effect.Effect<CodeitlabCredentialsRestoreResult, CodeitlabServiceError>;
    readonly start: Effect.Effect<CodeitlabCredentialsStatus, CodeitlabServiceError>;
    readonly stop: Effect.Effect<CodeitlabCredentialsStatus, CodeitlabServiceError>;
    /** Fetch the newest tiny model into the CodeItLab home. */
    readonly downloadModel: Effect.Effect<CodeitlabCredentialsModel, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/CredentialsService") {}

export class NexusService extends Context.Service<
  NexusService,
  {
    readonly catalog: Effect.Effect<NexusCatalog, CodeitlabServiceError>;
    readonly refresh: Effect.Effect<NexusCatalog, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/NexusService") {}

export class MemoryService extends Context.Service<
  MemoryService,
  {
    readonly list: (input?: {
      readonly scope?: "global" | "project";
      readonly projectId?: string | null;
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<MemoryEntry>>;
    readonly search: (input: MemorySearchInput) => Effect.Effect<ReadonlyArray<MemorySearchHit>>;
    readonly add: (input: {
      readonly scope: "global" | "project";
      readonly projectId?: string | null;
      readonly kind: MemoryEntry["kind"];
      readonly text: string;
      readonly tags?: ReadonlyArray<string>;
      readonly confidence?: number;
      readonly source?: MemoryEntry["source"];
    }) => Effect.Effect<MemoryEntry, CodeitlabServiceError>;
    readonly update: (
      id: string,
      patch: { readonly text?: string; readonly tags?: ReadonlyArray<string> },
    ) => Effect.Effect<MemoryEntry, CodeitlabServiceError>;
    readonly remove: (id: string) => Effect.Effect<void, CodeitlabServiceError>;
    readonly stats: Effect.Effect<MemoryStats>;
    readonly recall: (input: {
      readonly query: string;
      readonly projectId?: string | null;
      readonly limit?: number;
      readonly minScore?: number;
    }) => Effect.Effect<MemoryRecall>;
  }
>()("@codeitlab/core/services/MemoryService") {}

export class RoutingService extends Context.Service<
  RoutingService,
  {
    readonly catalog: Effect.Effect<RoutingCatalog, CodeitlabServiceError>;
    readonly decide: (
      input: RoutingDecideInput,
    ) => Effect.Effect<RoutingDecision, CodeitlabServiceError>;
    readonly history: (
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<RoutingDecision>, CodeitlabServiceError>;
    /** Latest cached provider/quota health snapshot (runs one check when empty). */
    readonly health: Effect.Effect<RoutingHealth, CodeitlabServiceError>;
    /** Probe every provider now and refresh the health snapshot. */
    readonly checkHealth: Effect.Effect<RoutingHealth, CodeitlabServiceError>;
    /**
     * Annotate a recorded decision after the automatic provider fallback
     * switched the run to the backup provider, so the history (and the UI
     * badge) explain why the turn ran on a different harness than the router
     * picked.
     */
    readonly recordFallback: (input: {
      readonly decisionId: string;
      readonly fromInstanceId: string;
      readonly toInstanceId: string;
      readonly toModel: string;
    }) => Effect.Effect<void, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/RoutingService") {}

export class PolicyService extends Context.Service<
  PolicyService,
  {
    readonly effective: (input?: {
      readonly providerInstanceId?: string;
    }) => Effect.Effect<EffectivePolicy, CodeitlabServiceError>;
    readonly setProfile: (profile: PolicyProfile) => Effect.Effect<void, CodeitlabServiceError>;
    readonly audit: (
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<PolicyAuditEntry>, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/PolicyService") {}

export class ReaService extends Context.Service<
  ReaService,
  {
    readonly status: Effect.Effect<ReaStatus, CodeitlabServiceError>;
    readonly ensureInstalled: Effect.Effect<ReaStatus, CodeitlabServiceError>;
    readonly capabilities: Effect.Effect<ReadonlyArray<ReaCapability>, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/ReaService") {}

export class CodeitlabContextService extends Context.Service<
  CodeitlabContextService,
  {
    readonly buildTurnContext: (
      input: CodeitlabTurnContextInput,
    ) => Effect.Effect<CodeitlabTurnContext, CodeitlabServiceError>;
  }
>()("@codeitlab/core/services/CodeitlabContextService") {}

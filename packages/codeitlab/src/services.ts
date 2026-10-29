import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { CodeItLabServiceError } from "./errors.ts";

import type { CodeItLabEcosystemInstallResult, CodeItLabEcosystemStatus } from "./ecosystem.ts";
import type {
  SandboxHealth,
  SandboxInstallInput,
  SandboxInstallResult,
  SandboxMachineCreateInput,
  SandboxMachineCreateResult,
  SandboxMachineRemoveInput,
  SandboxMachineRemoveResult,
  SandboxMachineStartInput,
  SandboxMachineStartResult,
  SandboxMachineStopInput,
  SandboxMachineStopResult,
  SandboxRunInput,
  SandboxRunResult,
  SandboxStatus,
  SandboxSyncInput,
  SandboxSyncResult,
} from "./sandbox.ts";
import type { CodeItLabXpRecordInput, CodeItLabXpRecordResult, CodeItLabXpState } from "./xp.ts";
import type {
  CodeItLabDeliveryDraft,
  CodeItLabDeliveryDraftInput,
  CodeItLabDeliveryHandoff,
  CodeItLabDeliveryHandoffInput,
  CodeItLabDeliveryInput,
  CodeItLabDeliveryResult,
  CodeItLabEngagementApplyToJobInput,
  CodeItLabEngagementApplyToJobResult,
  CodeItLabProfilePublishInput,
  CodeItLabProfilePublishResult,
  CodeItLabEngagementTransitionInput,
  CodeItLabEngagementTransitionResult,
  CodeItLabEngagementBridge,
  CodeItLabEngagementConfigureInput,
  CodeItLabEngagementList,
  CodeItLabEngagementMessageInput,
  CodeItLabEngagementMessageResult,
  CodeItLabEngagementMessages,
  CodeItLabEngagementMessagesInput,
} from "./engagements.ts";

export type {
  CodeItLabEcosystemInstallResult,
  CodeItLabEcosystemIntegration,
  CodeItLabEcosystemStatus,
} from "./ecosystem.ts";
export type {
  StudioExportResult,
  StudioProject,
  StudioProjectInput,
  StudioSlide,
} from "./studio.ts";
export type {
  CodeItLabRemotePairingLink,
  CodeItLabRemoteStatus,
  CodeItLabRemoteServer,
  CodeItLabRemoteTailnet,
  CodeItLabRemoteTunnel,
  CodeItLabRemoteTunnelAction,
} from "./remote.ts";
export type {
  CodeItLabIntegrationAction,
  CodeItLabIntegrationConfig,
  CodeItLabIntegrationId,
  CodeItLabIntegrationList,
  CodeItLabIntegrationPatch,
  CodeItLabIntegrationState,
  CodeItLabIntegrationStatus,
  CodeItLabIntegrationsSettings,
  CodeItLabShortsClip,
  CodeItLabShortsJob,
  CodeItLabShortsJobCreated,
  CodeItLabShortsJobRequest,
  CodeItLabShortsJobState,
} from "./integrations.ts";
import type {
  CodeItLabShortsJob,
  CodeItLabShortsJobCreated,
  CodeItLabShortsJobRequest,
} from "./integrations.ts";
import type {
  StudioExportResult,
  StudioProject,
  StudioProjectInput,
  StudioRenderResult,
} from "./studio.ts";
import type { CodeItLabQuestBoard } from "./quests.ts";
import type { CodeItLabTask } from "./board.ts";
import type {
  CodeItLabRemotePairingLink,
  CodeItLabRemoteStatus,
  CodeItLabRemoteTunnelAction,
} from "./remote.ts";
import type { CodeItLabIntegrationList, CodeItLabIntegrationPatch } from "./integrations.ts";
import type {
  CodeItLabCredentialsModel,
  CodeItLabCredentialsRestoreInput,
  CodeItLabCredentialsRestoreResult,
  CodeItLabCredentialsScanInput,
  CodeItLabCredentialsScanResult,
  CodeItLabCredentialsSettings,
  CodeItLabCredentialsStatus,
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

export interface CodeItLabTurnContextInput {
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

export interface CodeItLabTurnContext {
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
    readonly status: Effect.Effect<CodeItLabEcosystemStatus, CodeItLabServiceError>;
    readonly install: Effect.Effect<CodeItLabEcosystemInstallResult, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/EcosystemService") {}

/**
 * Decks and video scenes. The renderer is shared with the clients, so the
 * service only owns persistence and export — it never formats HTML itself.
 */
export class StudioService extends Context.Service<
  StudioService,
  {
    readonly list: Effect.Effect<ReadonlyArray<StudioProject>, CodeItLabServiceError>;
    readonly save: (
      input: StudioProjectInput,
    ) => Effect.Effect<StudioProject, CodeItLabServiceError>;
    readonly remove: (id: string) => Effect.Effect<boolean, CodeItLabServiceError>;
    readonly exportHtml: (id: string) => Effect.Effect<StudioExportResult, CodeItLabServiceError>;
    /** Render the project to an MP4 (video from code). */
    readonly render: (input: {
      readonly id: string;
      readonly fps?: number;
      readonly secondsPerSlide?: number;
    }) => Effect.Effect<StudioRenderResult, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/StudioService") {}

/**
 * The derived education board: one quest per capability, progress read from the
 * services that own that capability.
 */
/**
 * Kanban tasks in the database rather than one settings blob, so the board can
 * be read from more than one device. The service only stores what the board
 * already means; it never starts or schedules work.
 */
export class CodeItLabTasksService extends Context.Service<
  CodeItLabTasksService,
  {
    readonly list: Effect.Effect<ReadonlyArray<CodeItLabTask>, CodeItLabServiceError>;
    readonly upsert: (task: CodeItLabTask) => Effect.Effect<CodeItLabTask, CodeItLabServiceError>;
    readonly remove: (id: string) => Effect.Effect<boolean, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/CodeItLabTasksService") {}

export class QuestsService extends Context.Service<
  QuestsService,
  {
    readonly list: Effect.Effect<CodeItLabQuestBoard, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/QuestsService") {}

/**
 * Remote access over the network the user already owns: tailnet/LAN status,
 * a managed Cloudflare quick tunnel, and one-time pairing links for phones.
 */
export class RemoteService extends Context.Service<
  RemoteService,
  {
    readonly status: Effect.Effect<CodeItLabRemoteStatus, CodeItLabServiceError>;
    readonly createPairingLink: Effect.Effect<CodeItLabRemotePairingLink, CodeItLabServiceError>;
    readonly manageTunnel: (input: {
      readonly action: CodeItLabRemoteTunnelAction;
    }) => Effect.Effect<CodeItLabRemoteStatus, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/RemoteService") {}

/**
 * Whitelabel integrations: configure, probe, and agent-wire the self-hostable
 * engines behind the Shorts, Crew and Search surfaces.
 */
export class IntegrationsService extends Context.Service<
  IntegrationsService,
  {
    readonly list: Effect.Effect<CodeItLabIntegrationList, CodeItLabServiceError>;
    readonly set: (
      patch: CodeItLabIntegrationPatch,
    ) => Effect.Effect<CodeItLabIntegrationList, CodeItLabServiceError>;
    /** Submit a Shorts clip job to the configured engine. */
    readonly createShortsJob: (
      request: CodeItLabShortsJobRequest,
    ) => Effect.Effect<CodeItLabShortsJobCreated, CodeItLabServiceError>;
    /** Poll a Shorts clip job and normalise the engine response. */
    readonly shortsJobStatus: (
      jobId: string,
    ) => Effect.Effect<CodeItLabShortsJob, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/IntegrationsService") {}

export type {
  CodeItLabCredentialsModel,
  CodeItLabCredentialsRestoreInput,
  CodeItLabCredentialsRestoreResult,
  CodeItLabCredentialsScanInput,
  CodeItLabCredentialsScanResult,
  CodeItLabCredentialsSettings,
  CodeItLabCredentialsStatus,
} from "./credentials.ts";

/**
 * The local credentials proxy: detects secrets in outbound text, replaces them
 * with format-preserving fakes, restores the real values on the way back, and
 * runs the optional local gateway the provider base URLs can point at.
 */
export class CredentialsService extends Context.Service<
  CredentialsService,
  {
    readonly status: Effect.Effect<CodeItLabCredentialsStatus, CodeItLabServiceError>;
    readonly update: (
      settings: CodeItLabCredentialsSettings,
    ) => Effect.Effect<CodeItLabCredentialsStatus, CodeItLabServiceError>;
    /** Preview scan: returns the masked text and value-free findings. */
    readonly scan: (
      input: CodeItLabCredentialsScanInput,
    ) => Effect.Effect<CodeItLabCredentialsScanResult, CodeItLabServiceError>;
    /** Put the real values back into a response or tool output. */
    readonly restore: (
      input: CodeItLabCredentialsRestoreInput,
    ) => Effect.Effect<CodeItLabCredentialsRestoreResult, CodeItLabServiceError>;
    readonly start: Effect.Effect<CodeItLabCredentialsStatus, CodeItLabServiceError>;
    readonly stop: Effect.Effect<CodeItLabCredentialsStatus, CodeItLabServiceError>;
    /** Fetch the newest tiny model into the CodeItLab home. */
    readonly downloadModel: Effect.Effect<CodeItLabCredentialsModel, CodeItLabServiceError>;
    /**
     * The masked environment a program started by the app inherits. Real values
     * never leave this process: each entry carries the fake, and only the vault
     * can put the original back. Empty when the user turned this off.
     */
    readonly programEnvironment: Effect.Effect<
      Readonly<Record<string, string>>,
      CodeItLabServiceError
    >;
  }
>()("@codeitlab/core/services/CredentialsService") {}

export class NexusService extends Context.Service<
  NexusService,
  {
    readonly catalog: Effect.Effect<NexusCatalog, CodeItLabServiceError>;
    readonly refresh: Effect.Effect<NexusCatalog, CodeItLabServiceError>;
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
    }) => Effect.Effect<MemoryEntry, CodeItLabServiceError>;
    readonly update: (
      id: string,
      patch: { readonly text?: string; readonly tags?: ReadonlyArray<string> },
    ) => Effect.Effect<MemoryEntry, CodeItLabServiceError>;
    readonly remove: (id: string) => Effect.Effect<void, CodeItLabServiceError>;
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
    readonly catalog: Effect.Effect<RoutingCatalog, CodeItLabServiceError>;
    readonly decide: (
      input: RoutingDecideInput,
    ) => Effect.Effect<RoutingDecision, CodeItLabServiceError>;
    readonly history: (
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<RoutingDecision>, CodeItLabServiceError>;
    /** Latest cached provider/quota health snapshot (runs one check when empty). */
    readonly health: Effect.Effect<RoutingHealth, CodeItLabServiceError>;
    /** Probe every provider now and refresh the health snapshot. */
    readonly checkHealth: Effect.Effect<RoutingHealth, CodeItLabServiceError>;
    /**
     * Deep model scan: measure every model the providers advertise (one "hi"
     * turn each) in the background and return the health snapshot immediately.
     */
    readonly scanModels: Effect.Effect<RoutingHealth, CodeItLabServiceError>;
    /**
     * Annotate a recorded decision after the automatic provider fallback
     * switched the run to the backup provider, so the history (and the UI
     * badge) explain why the turn ran on a different harness than the router
     * picked.
     */
    readonly recordFallback: (input: {
      /** Omit to annotate the most recent recorded decision. */
      readonly decisionId?: string;
      readonly fromInstanceId: string;
      readonly toInstanceId: string;
      readonly toModel: string;
    }) => Effect.Effect<void, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/RoutingService") {}

export class PolicyService extends Context.Service<
  PolicyService,
  {
    readonly effective: (input?: {
      readonly providerInstanceId?: string;
    }) => Effect.Effect<EffectivePolicy, CodeItLabServiceError>;
    readonly setProfile: (profile: PolicyProfile) => Effect.Effect<void, CodeItLabServiceError>;
    readonly audit: (
      limit?: number,
    ) => Effect.Effect<ReadonlyArray<PolicyAuditEntry>, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/PolicyService") {}

export class ReaService extends Context.Service<
  ReaService,
  {
    readonly status: Effect.Effect<ReaStatus, CodeItLabServiceError>;
    readonly ensureInstalled: Effect.Effect<ReaStatus, CodeItLabServiceError>;
    readonly capabilities: Effect.Effect<ReadonlyArray<ReaCapability>, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/ReaService") {}

export class CodeItLabContextService extends Context.Service<
  CodeItLabContextService,
  {
    readonly buildTurnContext: (
      input: CodeItLabTurnContextInput,
    ) => Effect.Effect<CodeItLabTurnContext, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/CodeItLabContextService") {}

/**
 * Sandbox backends on this machine. The service owns the truth — probe,
 * consent-gated install, and the health check after it — so the Setup page
 * never has to guess whether a backend exists.
 */
export class SandboxService extends Context.Service<
  SandboxService,
  {
    readonly status: Effect.Effect<SandboxStatus, CodeItLabServiceError>;
    readonly install: (
      input: SandboxInstallInput,
    ) => Effect.Effect<SandboxInstallResult, CodeItLabServiceError>;
    /**
     * Deeper than status: every installed backend is asked the one question its
     * version check cannot answer (VM list, daemon, distributions), so "ready"
     * means a sandbox can run, not that a binary exists.
     */
    readonly health: Effect.Effect<SandboxHealth, CodeItLabServiceError>;
    /**
     * Creates the one machine for a backend. Consent is a literal `true`: a
     * machine is a machine-level change, so the server refuses without it.
     */
    readonly machineCreate: (
      input: SandboxMachineCreateInput,
    ) => Effect.Effect<SandboxMachineCreateResult, CodeItLabServiceError>;
    /** Starts the existing machine; a Tart VM is backgrounded and then verified. */
    readonly machineStart: (
      input: SandboxMachineStartInput,
    ) => Effect.Effect<SandboxMachineStartResult, CodeItLabServiceError>;
    /** Stops whichever machine is running; the app never leaves a VM unmanaged. */
    readonly machineStop: (
      input: SandboxMachineStopInput,
    ) => Effect.Effect<SandboxMachineStopResult, CodeItLabServiceError>;
    readonly machineRemove: (
      input: SandboxMachineRemoveInput,
    ) => Effect.Effect<SandboxMachineRemoveResult, CodeItLabServiceError>;
    /** Runs one command inside the machine that is running. */
    readonly run: (
      input: SandboxRunInput,
    ) => Effect.Effect<SandboxRunResult, CodeItLabServiceError>;
    /**
     * Copy the thread's git-tracked files into the machine, so a run can build
     * or test them. Tracked only: gitignored files never leave the host.
     */
    readonly machineSync: (
      input: SandboxSyncInput,
    ) => Effect.Effect<SandboxSyncResult, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/SandboxService") {}

/**
 * XP, level and streak for the send button. The server owns the ledger and the
 * clock: a client can only report that something finished, and a repeated id is
 * ignored, so the number never grows from a retry.
 */
export class XpService extends Context.Service<
  XpService,
  {
    readonly state: Effect.Effect<CodeItLabXpState, CodeItLabServiceError>;
    readonly record: (
      input: CodeItLabXpRecordInput,
    ) => Effect.Effect<CodeItLabXpRecordResult, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/XpService") {}

/**
 * The bridge to the user's own marketplace deployment.
 *
 * The app never holds money and never decides a release: it reads the
 * engagements the marketplace tracks and posts into the engagement thread the
 * marketplace owns, with the URL and token the user configured. When those are
 * missing or the deployment does not answer, every method reports a read-only
 * bridge with a reason instead of pretending to work.
 */
export class EngagementsService extends Context.Service<
  EngagementsService,
  {
    readonly bridge: Effect.Effect<CodeItLabEngagementBridge, CodeItLabServiceError>;
    readonly list: Effect.Effect<CodeItLabEngagementList, CodeItLabServiceError>;
    readonly messages: (
      input: CodeItLabEngagementMessagesInput,
    ) => Effect.Effect<CodeItLabEngagementMessages, CodeItLabServiceError>;
    readonly postMessage: (
      input: CodeItLabEngagementMessageInput,
    ) => Effect.Effect<CodeItLabEngagementMessageResult, CodeItLabServiceError>;
    readonly configure: (
      input: CodeItLabEngagementConfigureInput,
    ) => Effect.Effect<CodeItLabEngagementBridge, CodeItLabServiceError>;
    /** Compose a reviewed delivery from a thread's git state; sends nothing. */
    readonly draftDelivery: (
      input: CodeItLabDeliveryDraftInput,
    ) => Effect.Effect<CodeItLabDeliveryDraft, CodeItLabServiceError>;
    /**
     * Explain the delivery to the client in plain language. Falls back to the
     * deterministic handoff with a reason when no model answers; never sends.
     */
    readonly deliveryHandoff: (
      input: CodeItLabDeliveryHandoffInput,
    ) => Effect.Effect<CodeItLabDeliveryHandoff, CodeItLabServiceError>;
    /** Send the reviewed note and evidence; the marketplace decides the transition. */
    readonly deliver: (
      input: CodeItLabDeliveryInput,
    ) => Effect.Effect<CodeItLabDeliveryResult, CodeItLabServiceError>;
    /**
     * Accept, start, approve, cancel or dispute an engagement. Delivery has its
     * own call because it carries a note; these move the status and nothing else.
     */
    readonly transition: (
      input: CodeItLabEngagementTransitionInput,
    ) => Effect.Effect<CodeItLabEngagementTransitionResult, CodeItLabServiceError>;
    /** Apply to a marketplace job; the marketplace owns whether the application is accepted. */
    readonly applyToJob: (
      input: CodeItLabEngagementApplyToJobInput,
    ) => Effect.Effect<CodeItLabEngagementApplyToJobResult, CodeItLabServiceError>;
    /**
     * Copy the user's profile to the marketplace so a business can read it. Only
     * the fields the profile screen shows are sent; nothing is inferred.
     */
    readonly publishProfile: (
      input: CodeItLabProfilePublishInput,
    ) => Effect.Effect<CodeItLabProfilePublishResult, CodeItLabServiceError>;
  }
>()("@codeitlab/core/services/EngagementsService") {}

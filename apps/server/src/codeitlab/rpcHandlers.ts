import {
  type CodeItLabEcosystemInstallResult,
  type CodeItLabEcosystemStatus,
  type CodeItLabServiceError,
  EcosystemService,
  type EffectivePolicy,
  type MemoryEntry,
  type MemorySearchHit,
  type MemoryStats,
  MemoryService,
  type NexusCatalog,
  NexusService,
  PolicyService,
  QuestsService,
  CodeItLabTasksService,
  type ReaStatus,
  ReaService,
  type RoutingCatalog,
  type RoutingDecision,
  type RoutingHealth,
  RoutingService,
  type StudioDeleteResult,
  type StudioExportResult,
  type StudioRenderResult,
  type CodeItLabQuestBoard,
  type StudioProject,
  type StudioProjectInput,
  type StudioProjectList,
  StudioService,
  type CodeItLabRemotePairingLink,
  type CodeItLabRemoteStatus,
  type CodeItLabRemoteTunnelAction,
  RemoteService,
  type CodeItLabIntegrationList,
  type CodeItLabIntegrationPatch,
  type CodeItLabModelEndpointProbeInput,
  type CodeItLabModelEndpointProbeResult,
  type CodeItLabShortsJob,
  type CodeItLabShortsJobCreated,
  type CodeItLabShortsJobRequest,
  IntegrationsService,
  type CodeItLabCredentialsModel,
  type CodeItLabCredentialsRestoreResult,
  type CodeItLabCredentialsScanInput,
  type CodeItLabCredentialsScanResult,
  type CodeItLabCredentialsSettings,
  type CodeItLabCredentialsStatus,
  CredentialsService,
  type SandboxHealth,
  type SandboxInstallInput,
  type SandboxInstallResult,
  type SandboxMachineCreateInput,
  type SandboxMachineCreateResult,
  type SandboxMachineStartInput,
  type SandboxMachineStartResult,
  type SandboxMachineStopInput,
  type SandboxMachineStopResult,
  type SandboxMachineRemoveInput,
  type SandboxMachineRemoveResult,
  type SandboxRunInput,
  type SandboxRunResult,
  type SandboxStatus,
  SandboxService,
  type CodeItLabXpRecordInput,
  type CodeItLabXpRecordResult,
  type CodeItLabXpState,
  XpService,
  type CodeItLabEngagementBridge,
  type CodeItLabEngagementConfigureInput,
  type CodeItLabEngagementList,
  type CodeItLabEngagementMessageInput,
  type CodeItLabEngagementMessageResult,
  type CodeItLabEngagementApplyToJobInput,
  type CodeItLabEngagementApplyToJobResult,
  type CodeItLabProfilePublishInput,
  type CodeItLabProfilePublishResult,
  type CodeItLabEngagementTransitionInput,
  type CodeItLabEngagementTransitionResult,
  type CodeItLabEngagementMessages,
  type CodeItLabEngagementMessagesInput,
  type CodeItLabDeliveryDraft,
  type CodeItLabDeliveryDraftInput,
  type CodeItLabDeliveryHandoff,
  type CodeItLabDeliveryHandoffInput,
  type CodeItLabDeliveryInput,
  type CodeItLabDeliveryResult,
  EngagementsService,
} from "@codeitlab/contracts";
import type { CodeItLabTask } from "@codeitlab/core/board";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as SoulModule from "./memory/Soul.ts";
import { probeModelEndpoint } from "./models/ModelEndpointProbe.ts";

/**
 * Typed handler map for the CodeItLab feature RPCs.
 *
 * The interface uses the literal wire names so the object keeps an exact type:
 * a computed-key object widens to an index signature and erases the handler
 * payload types. Optional payload fields carry `| undefined` because the wire
 * schema uses `optionalKey`.
 *
 * Every handler is a thin transport: decode already happened in the RPC layer,
 * and each call delegates to exactly one feature service. Failures are the
 * shared `CodeItLabServiceError`, which is also the wire error schema, so no
 * translation is needed.
 */
export interface CodeItLabRpcHandlers {
  readonly "codeitlab.nexus.catalog": () => Effect.Effect<NexusCatalog, CodeItLabServiceError>;
  readonly "codeitlab.nexus.refresh": () => Effect.Effect<NexusCatalog, CodeItLabServiceError>;
  readonly "codeitlab.nexus.skills.list": () => Effect.Effect<
    ReadonlyArray<NexusCatalog["skills"][number]>,
    CodeItLabServiceError
  >;
  readonly "codeitlab.nexus.mcp.merge": () => Effect.Effect<
    ReadonlyArray<NexusCatalog["mcpServers"][number]>,
    CodeItLabServiceError
  >;
  readonly "codeitlab.nexus.sessions.list": () => Effect.Effect<
    ReadonlyArray<NexusCatalog["sessions"][number]>,
    CodeItLabServiceError
  >;
  readonly "codeitlab.memory.list": (input: {
    readonly scope?: "global" | "project" | undefined;
    readonly projectId?: string | null | undefined;
    readonly limit?: number | undefined;
  }) => Effect.Effect<ReadonlyArray<MemoryEntry>, CodeItLabServiceError>;
  readonly "codeitlab.memory.search": (input: {
    readonly query: string;
    readonly projectId?: string | null | undefined;
    readonly limit?: number | undefined;
    readonly minScore?: number | undefined;
  }) => Effect.Effect<ReadonlyArray<MemorySearchHit>, CodeItLabServiceError>;
  readonly "codeitlab.memory.add": (input: {
    readonly scope: "global" | "project";
    readonly projectId?: string | null | undefined;
    readonly kind: MemoryEntry["kind"];
    readonly text: string;
    readonly tags?: ReadonlyArray<string> | undefined;
    readonly confidence?: number | undefined;
    readonly source?: MemoryEntry["source"] | undefined;
  }) => Effect.Effect<MemoryEntry, CodeItLabServiceError>;
  readonly "codeitlab.memory.update": (input: {
    readonly id: string;
    readonly text?: string | undefined;
    readonly tags?: ReadonlyArray<string> | undefined;
  }) => Effect.Effect<MemoryEntry, CodeItLabServiceError>;
  readonly "codeitlab.memory.delete": (input: {
    readonly id: string;
  }) => Effect.Effect<{}, CodeItLabServiceError>;
  readonly "codeitlab.memory.stats": () => Effect.Effect<MemoryStats, CodeItLabServiceError>;
  readonly "codeitlab.memory.soul": () => Effect.Effect<
    { readonly memory: string; readonly user: string },
    CodeItLabServiceError
  >;
  readonly "codeitlab.routing.catalog": () => Effect.Effect<RoutingCatalog, CodeItLabServiceError>;
  readonly "codeitlab.routing.decide": (input: {
    readonly prompt: string;
    readonly projectId?: string | null | undefined;
    readonly attachments?: ReadonlyArray<string> | undefined;
    readonly taskClass?: RoutingDecision["taskClass"] | undefined;
  }) => Effect.Effect<RoutingDecision, CodeItLabServiceError>;
  readonly "codeitlab.routing.history": (input: {
    readonly limit?: number | undefined;
  }) => Effect.Effect<ReadonlyArray<RoutingDecision>, CodeItLabServiceError>;
  readonly "codeitlab.routing.health": () => Effect.Effect<RoutingHealth, CodeItLabServiceError>;
  readonly "codeitlab.routing.checkHealth": () => Effect.Effect<
    RoutingHealth,
    CodeItLabServiceError
  >;
  readonly "codeitlab.policy.effective": (input: {
    readonly providerInstanceId?: string | undefined;
  }) => Effect.Effect<EffectivePolicy, CodeItLabServiceError>;
  readonly "codeitlab.policy.setProfile": (input: {
    readonly profile: "standard" | "permissive";
  }) => Effect.Effect<EffectivePolicy, CodeItLabServiceError>;
  readonly "codeitlab.rea.status": () => Effect.Effect<ReaStatus, CodeItLabServiceError>;
  readonly "codeitlab.rea.install": () => Effect.Effect<ReaStatus, CodeItLabServiceError>;
  readonly "codeitlab.ecosystem.status": () => Effect.Effect<
    CodeItLabEcosystemStatus,
    CodeItLabServiceError
  >;
  readonly "codeitlab.ecosystem.install": () => Effect.Effect<
    CodeItLabEcosystemInstallResult,
    CodeItLabServiceError
  >;
  readonly "codeitlab.studio.list": () => Effect.Effect<StudioProjectList, CodeItLabServiceError>;
  readonly "codeitlab.studio.save": (input: {
    readonly project: StudioProjectInput;
  }) => Effect.Effect<StudioProject, CodeItLabServiceError>;
  readonly "codeitlab.studio.delete": (input: {
    readonly id: string;
  }) => Effect.Effect<StudioDeleteResult, CodeItLabServiceError>;
  readonly "codeitlab.studio.export": (input: {
    readonly id: string;
  }) => Effect.Effect<StudioExportResult, CodeItLabServiceError>;
  readonly "codeitlab.quests.list": () => Effect.Effect<CodeItLabQuestBoard, CodeItLabServiceError>;
  readonly "codeitlab.tasks.list": () => Effect.Effect<
    { readonly tasks: ReadonlyArray<CodeItLabTask> },
    CodeItLabServiceError
  >;
  readonly "codeitlab.tasks.upsert": (input: {
    readonly task: CodeItLabTask;
  }) => Effect.Effect<{ readonly task: CodeItLabTask }, CodeItLabServiceError>;
  readonly "codeitlab.tasks.remove": (input: {
    readonly id: string;
  }) => Effect.Effect<{ readonly removed: boolean }, CodeItLabServiceError>;
  readonly "codeitlab.studio.render": (input: {
    readonly id: string;
    readonly fps?: number | undefined;
    readonly secondsPerSlide?: number | undefined;
  }) => Effect.Effect<StudioRenderResult, CodeItLabServiceError>;
  readonly "codeitlab.remote.status": () => Effect.Effect<
    CodeItLabRemoteStatus,
    CodeItLabServiceError
  >;
  readonly "codeitlab.remote.createPairingLink": () => Effect.Effect<
    CodeItLabRemotePairingLink,
    CodeItLabServiceError
  >;
  readonly "codeitlab.remote.manageTunnel": (input: {
    readonly action: CodeItLabRemoteTunnelAction;
  }) => Effect.Effect<CodeItLabRemoteStatus, CodeItLabServiceError>;
  readonly "codeitlab.integrations.list": () => Effect.Effect<
    CodeItLabIntegrationList,
    CodeItLabServiceError
  >;
  readonly "codeitlab.integrations.set": (input: {
    readonly patch: CodeItLabIntegrationPatch;
  }) => Effect.Effect<CodeItLabIntegrationList, CodeItLabServiceError>;
  readonly "codeitlab.integrations.shorts.createJob": (
    input: CodeItLabShortsJobRequest,
  ) => Effect.Effect<CodeItLabShortsJobCreated, CodeItLabServiceError>;
  readonly "codeitlab.integrations.shorts.jobStatus": (input: {
    readonly jobId: string;
  }) => Effect.Effect<CodeItLabShortsJob, CodeItLabServiceError>;
  readonly "codeitlab.credentials.status": () => Effect.Effect<
    CodeItLabCredentialsStatus,
    CodeItLabServiceError
  >;
  readonly "codeitlab.credentials.update": (input: {
    readonly settings: CodeItLabCredentialsSettings;
  }) => Effect.Effect<CodeItLabCredentialsStatus, CodeItLabServiceError>;
  readonly "codeitlab.credentials.scan": (
    input: CodeItLabCredentialsScanInput,
  ) => Effect.Effect<CodeItLabCredentialsScanResult, CodeItLabServiceError>;
  readonly "codeitlab.credentials.restore": (input: {
    readonly text: string;
  }) => Effect.Effect<CodeItLabCredentialsRestoreResult, CodeItLabServiceError>;
  readonly "codeitlab.credentials.start": () => Effect.Effect<
    CodeItLabCredentialsStatus,
    CodeItLabServiceError
  >;
  readonly "codeitlab.credentials.stop": () => Effect.Effect<
    CodeItLabCredentialsStatus,
    CodeItLabServiceError
  >;
  readonly "codeitlab.credentials.downloadModel": () => Effect.Effect<
    CodeItLabCredentialsModel,
    CodeItLabServiceError
  >;
  readonly "codeitlab.models.probeEndpoint": (
    input: CodeItLabModelEndpointProbeInput,
  ) => Effect.Effect<CodeItLabModelEndpointProbeResult, CodeItLabServiceError>;
  readonly "codeitlab.sandbox.status": () => Effect.Effect<SandboxStatus, CodeItLabServiceError>;
  readonly "codeitlab.sandbox.install": (
    input: SandboxInstallInput,
  ) => Effect.Effect<SandboxInstallResult, CodeItLabServiceError>;
  readonly "codeitlab.sandbox.health": () => Effect.Effect<SandboxHealth, CodeItLabServiceError>;
  readonly "codeitlab.sandbox.machineCreate": (
    input: SandboxMachineCreateInput,
  ) => Effect.Effect<SandboxMachineCreateResult, CodeItLabServiceError>;
  readonly "codeitlab.sandbox.machineStart": (
    input: SandboxMachineStartInput,
  ) => Effect.Effect<SandboxMachineStartResult, CodeItLabServiceError>;
  readonly "codeitlab.sandbox.machineStop": (
    input: SandboxMachineStopInput,
  ) => Effect.Effect<SandboxMachineStopResult, CodeItLabServiceError>;
  readonly "codeitlab.sandbox.machineRemove": (
    input: SandboxMachineRemoveInput,
  ) => Effect.Effect<SandboxMachineRemoveResult, CodeItLabServiceError>;
  readonly "codeitlab.sandbox.run": (
    input: SandboxRunInput,
  ) => Effect.Effect<SandboxRunResult, CodeItLabServiceError>;
  readonly "codeitlab.xp.state": () => Effect.Effect<CodeItLabXpState, CodeItLabServiceError>;
  readonly "codeitlab.xp.record": (
    input: CodeItLabXpRecordInput,
  ) => Effect.Effect<CodeItLabXpRecordResult, CodeItLabServiceError>;
  readonly "codeitlab.engagements.bridge": () => Effect.Effect<
    CodeItLabEngagementBridge,
    CodeItLabServiceError
  >;
  readonly "codeitlab.engagements.list": () => Effect.Effect<
    CodeItLabEngagementList,
    CodeItLabServiceError
  >;
  readonly "codeitlab.engagements.messages": (
    input: CodeItLabEngagementMessagesInput,
  ) => Effect.Effect<CodeItLabEngagementMessages, CodeItLabServiceError>;
  readonly "codeitlab.engagements.postMessage": (
    input: CodeItLabEngagementMessageInput,
  ) => Effect.Effect<CodeItLabEngagementMessageResult, CodeItLabServiceError>;
  readonly "codeitlab.engagements.configure": (
    input: CodeItLabEngagementConfigureInput,
  ) => Effect.Effect<CodeItLabEngagementBridge, CodeItLabServiceError>;
  readonly "codeitlab.engagements.deliveryHandoff": (
    input: CodeItLabDeliveryHandoffInput,
  ) => Effect.Effect<CodeItLabDeliveryHandoff, CodeItLabServiceError>;
  readonly "codeitlab.engagements.deliveryDraft": (
    input: CodeItLabDeliveryDraftInput,
  ) => Effect.Effect<CodeItLabDeliveryDraft, CodeItLabServiceError>;
  readonly "codeitlab.engagements.deliver": (
    input: CodeItLabDeliveryInput,
  ) => Effect.Effect<CodeItLabDeliveryResult, CodeItLabServiceError>;
  readonly "codeitlab.engagements.transition": (
    input: CodeItLabEngagementTransitionInput,
  ) => Effect.Effect<CodeItLabEngagementTransitionResult, CodeItLabServiceError>;
  readonly "codeitlab.engagements.applyToJob": (
    input: CodeItLabEngagementApplyToJobInput,
  ) => Effect.Effect<CodeItLabEngagementApplyToJobResult, CodeItLabServiceError>;
  readonly "codeitlab.profile.publish": (
    input: CodeItLabProfilePublishInput,
  ) => Effect.Effect<CodeItLabProfilePublishResult, CodeItLabServiceError>;
}

/**
 * Builds the handler map from the live feature services. The composition layer
 * in `./index.ts` provides them once per server lifetime.
 */
export const makeCodeItLabRpcHandlers: Effect.Effect<
  CodeItLabRpcHandlers,
  never,
  | EcosystemService
  | QuestsService
  | MemoryService
  | NexusService
  | PolicyService
  | ReaService
  | RoutingService
  | StudioService
  | RemoteService
  | IntegrationsService
  | CredentialsService
  | SandboxService
  | XpService
  | CodeItLabTasksService
  | EngagementsService
> = Effect.gen(function* () {
  const memory = yield* MemoryService;
  // Optional on purpose: the soul is a convenience view over the same corpus, so a
  // deployment without it should lose the panel, not every RPC in this file.
  const soul = yield* Effect.serviceOption(SoulModule.Soul);
  const nexus = yield* NexusService;
  const policy = yield* PolicyService;
  const rea = yield* ReaService;
  const routing = yield* RoutingService;
  const ecosystem = yield* EcosystemService;
  const studio = yield* StudioService;
  const quests = yield* QuestsService;
  const tasks = yield* CodeItLabTasksService;
  const remote = yield* RemoteService;
  const integrations = yield* IntegrationsService;
  const credentials = yield* CredentialsService;
  const sandbox = yield* SandboxService;
  const xp = yield* XpService;
  const engagements = yield* EngagementsService;

  return {
    "codeitlab.nexus.catalog": () => nexus.catalog,
    "codeitlab.nexus.refresh": () => nexus.refresh,
    "codeitlab.nexus.skills.list": () =>
      nexus.catalog.pipe(Effect.map((catalog) => catalog.skills)),
    "codeitlab.nexus.mcp.merge": () =>
      nexus.catalog.pipe(Effect.map((catalog) => catalog.mcpServers)),
    "codeitlab.nexus.sessions.list": () =>
      nexus.catalog.pipe(Effect.map((catalog) => catalog.sessions)),
    "codeitlab.memory.list": (input) =>
      memory.list({
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    "codeitlab.memory.search": (input) =>
      memory.search({
        query: input.query,
        projectId: input.projectId ?? null,
        limit: input.limit ?? 8,
        minScore: input.minScore ?? 0.2,
      }),
    "codeitlab.memory.add": (input) =>
      memory.add({
        scope: input.scope,
        kind: input.kind,
        text: input.text,
        ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        ...(input.source === undefined ? {} : { source: input.source }),
      }),
    "codeitlab.memory.update": (input) =>
      memory.update(input.id, {
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      }),
    "codeitlab.memory.delete": (input) => memory.remove(input.id).pipe(Effect.as({})),
    "codeitlab.memory.stats": () => memory.stats,
    "codeitlab.memory.soul": () =>
      Option.match(soul, {
        onNone: () => Effect.succeed({ memory: "", user: "" }),
        onSome: (service) => service.read,
      }),
    "codeitlab.routing.catalog": () => routing.catalog,
    "codeitlab.routing.decide": (input) =>
      routing.decide({
        prompt: input.prompt,
        projectId: input.projectId ?? null,
        attachments: input.attachments ?? [],
        ...(input.taskClass === undefined ? {} : { taskClass: input.taskClass }),
      }),
    "codeitlab.routing.history": (input) => routing.history(input.limit),
    "codeitlab.routing.health": () => routing.health,
    // A manual check also kicks the deep model scan: the first-run wizard and
    // the Routing page's "Check now" must discover every advertised model, not
    // only the light probe's shortlist.
    "codeitlab.routing.checkHealth": () =>
      routing.checkHealth.pipe(Effect.andThen(routing.scanModels)),
    "codeitlab.policy.effective": (input) =>
      policy.effective(
        input.providerInstanceId === undefined
          ? {}
          : { providerInstanceId: input.providerInstanceId },
      ),
    "codeitlab.policy.setProfile": (input) =>
      policy.setProfile(input.profile).pipe(Effect.andThen(policy.effective())),
    "codeitlab.rea.status": () => rea.status,
    "codeitlab.rea.install": () => rea.ensureInstalled,
    "codeitlab.ecosystem.status": () => ecosystem.status,
    "codeitlab.ecosystem.install": () => ecosystem.install,
    "codeitlab.studio.list": () => studio.list.pipe(Effect.map((projects) => ({ projects }))),
    "codeitlab.studio.save": (input) => studio.save(input.project),
    "codeitlab.studio.delete": (input) =>
      studio.remove(input.id).pipe(Effect.map((deleted) => ({ deleted }))),
    "codeitlab.studio.export": (input) => studio.exportHtml(input.id),
    "codeitlab.quests.list": () => quests.list,
    "codeitlab.tasks.list": () => tasks.list.pipe(Effect.map((entries) => ({ tasks: entries }))),
    "codeitlab.tasks.upsert": (input) =>
      tasks.upsert(input.task).pipe(Effect.map((task) => ({ task }))),
    "codeitlab.tasks.remove": (input) =>
      tasks.remove(input.id).pipe(Effect.map((removed) => ({ removed }))),
    "codeitlab.studio.render": (input) =>
      studio.render({
        id: input.id,
        ...(input.fps === undefined ? {} : { fps: input.fps }),
        ...(input.secondsPerSlide === undefined ? {} : { secondsPerSlide: input.secondsPerSlide }),
      }),
    "codeitlab.remote.status": () => remote.status,
    "codeitlab.remote.createPairingLink": () => remote.createPairingLink,
    "codeitlab.remote.manageTunnel": (input) => remote.manageTunnel({ action: input.action }),
    "codeitlab.integrations.list": () => integrations.list,
    "codeitlab.integrations.set": (input) => integrations.set(input.patch),
    "codeitlab.integrations.shorts.createJob": (input) => integrations.createShortsJob(input),
    "codeitlab.integrations.shorts.jobStatus": (input) => integrations.shortsJobStatus(input.jobId),
    "codeitlab.credentials.status": () => credentials.status,
    "codeitlab.credentials.update": (input) => credentials.update(input.settings),
    "codeitlab.credentials.scan": (input) => credentials.scan(input),
    "codeitlab.credentials.restore": (input) => credentials.restore(input),
    "codeitlab.credentials.start": () => credentials.start,
    "codeitlab.credentials.stop": () => credentials.stop,
    "codeitlab.credentials.downloadModel": () => credentials.downloadModel,
    "codeitlab.models.probeEndpoint": (input) => probeModelEndpoint(input),
    "codeitlab.sandbox.status": () => sandbox.status,
    "codeitlab.sandbox.install": (input) => sandbox.install(input),
    "codeitlab.sandbox.health": () => sandbox.health,
    "codeitlab.sandbox.machineCreate": (input) => sandbox.machineCreate(input),
    "codeitlab.sandbox.machineStart": (input) => sandbox.machineStart(input),
    "codeitlab.sandbox.machineStop": (input) => sandbox.machineStop(input),
    "codeitlab.sandbox.machineRemove": (input) => sandbox.machineRemove(input),
    "codeitlab.sandbox.run": (input) => sandbox.run(input),
    "codeitlab.xp.state": () => xp.state,
    "codeitlab.xp.record": (input) => xp.record(input),
    "codeitlab.engagements.bridge": () => engagements.bridge,
    "codeitlab.engagements.list": () => engagements.list,
    "codeitlab.engagements.messages": (input) => engagements.messages(input),
    "codeitlab.engagements.postMessage": (input) => engagements.postMessage(input),
    "codeitlab.engagements.configure": (input) => engagements.configure(input),
    "codeitlab.engagements.deliveryDraft": (input) => engagements.draftDelivery(input),
    "codeitlab.engagements.deliveryHandoff": (input) => engagements.deliveryHandoff(input),
    "codeitlab.engagements.deliver": (input) => engagements.deliver(input),
    "codeitlab.engagements.transition": (input) => engagements.transition(input),
    "codeitlab.engagements.applyToJob": (input) => engagements.applyToJob(input),
    "codeitlab.profile.publish": (input) => engagements.publishProfile(input),
  };
});

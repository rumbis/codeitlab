import { CodeItLabContextService } from "@codeitlab/core/services";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as TurnContextModule from "./context.ts";
import * as EcosystemModule from "./ecosystem/EcosystemService.ts";
import * as MemoryModule from "./memory/MemoryService.ts";
import * as NexusModule from "./nexus/NexusService.ts";
import * as PolicyModule from "./policy/PolicyService.ts";
import * as ReaModule from "./rea/ReaService.ts";
import * as RoutingModule from "./routing/RoutingService.ts";
import * as StudioModule from "./studio/StudioService.ts";
import * as RemoteModule from "./remote/RemoteService.ts";
import * as IntegrationsModule from "./integrations/IntegrationsService.ts";
import * as QuestsModule from "./quests/QuestsService.ts";
import * as BoardTasksModule from "./board/TasksService.ts";
import * as CodeItLabTasksRepositoryModule from "../persistence/CodeItLabTasks.ts";
import * as CredentialsModule from "./credentials/CredentialsService.ts";
import * as SandboxModule from "./sandbox/SandboxService.ts";
import * as XpModule from "./xp/XpService.ts";
import * as EngagementsModule from "./engagements/EngagementsService.ts";
import { makeCodeItLabRpcHandlers, type CodeItLabRpcHandlers } from "./rpcHandlers.ts";
import { registerCodeItLabContextService } from "./turnInjection.ts";

/**
 * Server composition for the CodeItLab features.
 *
 * One instance of every feature service per server lifetime, plus the RPC
 * handler map built from them. `ws.ts` yields the handler tag inside the RPC
 * layer so the wire methods are registered exactly like any built-in method.
 */

export class CodeItLabRpcHandlersService extends Context.Service<
  CodeItLabRpcHandlersService,
  CodeItLabRpcHandlers
>()("rumbis/codeitlab/CodeItLabRpcHandlersService") {}

/**
 * The feature services that other feature services depend on. `Layer.mergeAll`
 * only merges outputs — it does not feed one merged layer into another's
 * requirements — so the quest board (which probes every feature) is provided
 * this base explicitly below. Without that, the server boots and dies with
 * "Service not found: .../MemoryService" the first time the quest layer is built.
 */
const baseFeatureLayer = Layer.mergeAll(
  MemoryModule.memoryLayer,
  ReaModule.layer,
  PolicyModule.layer,
  RoutingModule.layer,
  NexusModule.layer,
  EcosystemModule.layer,
  StudioModule.layer,
  RemoteModule.layer,
  IntegrationsModule.layer,
  CredentialsModule.layer,
  SandboxModule.liveLayer,
  XpModule.layer,
  EngagementsModule.layer,
);

/** The board service needs the database repository; the quest board reads it. */
const boardTasksLayer = BoardTasksModule.layer.pipe(
  Layer.provide(CodeItLabTasksRepositoryModule.layer),
);

const featureLayer = Layer.mergeAll(
  baseFeatureLayer,
  boardTasksLayer,
  QuestsModule.layer.pipe(Layer.provide(Layer.merge(baseFeatureLayer, boardTasksLayer))),
);

/**
 * The per-turn context service depends on every other feature: it composes
 * memory recall, routing decision, policy block and the Nexus skill/MCP summary
 * into one instruction block.
 */
const turnContextLayer = TurnContextModule.layer.pipe(Layer.provide(featureLayer));

/** Feature services as seen by the rest of the server (e.g. turn injection). */
export const servicesLayer = Layer.merge(featureLayer, turnContextLayer);

/** Registers the turn-context service for the orchestration turn hook. */
const registerTurnContextLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    registerCodeItLabContextService(yield* CodeItLabContextService);
    yield* Effect.logInfo("CodeItLab turn context registered.");
  }),
);

/**
 * Fallback handler map for contexts that build the WebSocket layer without the
 * CodeItLab services (focused tests, alternate embeddings). Production always
 * provides the real handlers; a call that reaches this map is a wiring bug and
 * fails loudly instead of returning fake data.
 */
const unavailable = (method: string) => () =>
  Effect.die(new Error(`CodeItLab RPC ${method} is not wired in this context.`));

export const unavailableCodeItLabHandlers: CodeItLabRpcHandlers = {
  "codeitlab.nexus.catalog": unavailable("codeitlab.nexus.catalog"),
  "codeitlab.nexus.refresh": unavailable("codeitlab.nexus.refresh"),
  "codeitlab.nexus.skills.list": unavailable("codeitlab.nexus.skills.list"),
  "codeitlab.nexus.mcp.merge": unavailable("codeitlab.nexus.mcp.merge"),
  "codeitlab.nexus.sessions.list": unavailable("codeitlab.nexus.sessions.list"),
  "codeitlab.memory.list": unavailable("codeitlab.memory.list"),
  "codeitlab.memory.search": unavailable("codeitlab.memory.search"),
  "codeitlab.memory.add": unavailable("codeitlab.memory.add"),
  "codeitlab.memory.update": unavailable("codeitlab.memory.update"),
  "codeitlab.memory.delete": unavailable("codeitlab.memory.delete"),
  "codeitlab.memory.stats": unavailable("codeitlab.memory.stats"),
  "codeitlab.memory.soul": unavailable("codeitlab.memory.soul"),
  "codeitlab.routing.catalog": unavailable("codeitlab.routing.catalog"),
  "codeitlab.routing.decide": unavailable("codeitlab.routing.decide"),
  "codeitlab.routing.history": unavailable("codeitlab.routing.history"),
  "codeitlab.routing.health": unavailable("codeitlab.routing.health"),
  "codeitlab.routing.checkHealth": unavailable("codeitlab.routing.checkHealth"),
  "codeitlab.policy.effective": unavailable("codeitlab.policy.effective"),
  "codeitlab.policy.setProfile": unavailable("codeitlab.policy.setProfile"),
  "codeitlab.rea.status": unavailable("codeitlab.rea.status"),
  "codeitlab.rea.install": unavailable("codeitlab.rea.install"),
  "codeitlab.ecosystem.status": unavailable("codeitlab.ecosystem.status"),
  "codeitlab.ecosystem.install": unavailable("codeitlab.ecosystem.install"),
  "codeitlab.studio.list": unavailable("codeitlab.studio.list"),
  "codeitlab.studio.save": unavailable("codeitlab.studio.save"),
  "codeitlab.studio.delete": unavailable("codeitlab.studio.delete"),
  "codeitlab.studio.export": unavailable("codeitlab.studio.export"),
  "codeitlab.studio.render": unavailable("codeitlab.studio.render"),
  "codeitlab.quests.list": unavailable("codeitlab.quests.list"),
  "codeitlab.tasks.list": unavailable("codeitlab.tasks.list"),
  "codeitlab.tasks.upsert": unavailable("codeitlab.tasks.upsert"),
  "codeitlab.tasks.remove": unavailable("codeitlab.tasks.remove"),
  "codeitlab.remote.status": unavailable("codeitlab.remote.status"),
  "codeitlab.remote.createPairingLink": unavailable("codeitlab.remote.createPairingLink"),
  "codeitlab.remote.manageTunnel": unavailable("codeitlab.remote.manageTunnel"),
  "codeitlab.integrations.list": unavailable("codeitlab.integrations.list"),
  "codeitlab.integrations.set": unavailable("codeitlab.integrations.set"),
  "codeitlab.integrations.shorts.createJob": unavailable("codeitlab.integrations.shorts.createJob"),
  "codeitlab.integrations.shorts.jobStatus": unavailable("codeitlab.integrations.shorts.jobStatus"),
  "codeitlab.credentials.status": unavailable("codeitlab.credentials.status"),
  "codeitlab.credentials.update": unavailable("codeitlab.credentials.update"),
  "codeitlab.credentials.scan": unavailable("codeitlab.credentials.scan"),
  "codeitlab.credentials.restore": unavailable("codeitlab.credentials.restore"),
  "codeitlab.credentials.start": unavailable("codeitlab.credentials.start"),
  "codeitlab.credentials.stop": unavailable("codeitlab.credentials.stop"),
  "codeitlab.credentials.downloadModel": unavailable("codeitlab.credentials.downloadModel"),
  "codeitlab.models.probeEndpoint": unavailable("codeitlab.models.probeEndpoint"),
  "codeitlab.sandbox.status": unavailable("codeitlab.sandbox.status"),
  "codeitlab.sandbox.install": unavailable("codeitlab.sandbox.install"),
  "codeitlab.sandbox.health": unavailable("codeitlab.sandbox.health"),
  "codeitlab.sandbox.machineCreate": unavailable("codeitlab.sandbox.machineCreate"),
  "codeitlab.sandbox.machineStart": unavailable("codeitlab.sandbox.machineStart"),
  "codeitlab.sandbox.machineStop": unavailable("codeitlab.sandbox.machineStop"),
  "codeitlab.sandbox.machineRemove": unavailable("codeitlab.sandbox.machineRemove"),
  "codeitlab.sandbox.run": unavailable("codeitlab.sandbox.run"),
  "codeitlab.xp.state": unavailable("codeitlab.xp.state"),
  "codeitlab.xp.record": unavailable("codeitlab.xp.record"),
  "codeitlab.engagements.bridge": unavailable("codeitlab.engagements.bridge"),
  "codeitlab.engagements.list": unavailable("codeitlab.engagements.list"),
  "codeitlab.engagements.messages": unavailable("codeitlab.engagements.messages"),
  "codeitlab.engagements.postMessage": unavailable("codeitlab.engagements.postMessage"),
  "codeitlab.engagements.configure": unavailable("codeitlab.engagements.configure"),
  "codeitlab.engagements.deliveryDraft": unavailable("codeitlab.engagements.deliveryDraft"),
  "codeitlab.engagements.deliveryHandoff": unavailable("codeitlab.engagements.deliveryHandoff"),
  "codeitlab.engagements.deliver": unavailable("codeitlab.engagements.deliver"),
  "codeitlab.engagements.transition": unavailable("codeitlab.engagements.transition"),
  "codeitlab.engagements.applyToJob": unavailable("codeitlab.engagements.applyToJob"),
};

/**
 * Everything the server needs: the feature services (so the orchestration turn
 * hook sees `CodeItLabContextService`), the handler map for the WebSocket
 * transport, and the startup registration of the turn-context service.
 */
export const layer = Layer.merge(
  Layer.effect(CodeItLabRpcHandlersService, makeCodeItLabRpcHandlers),
  registerTurnContextLayer,
).pipe(Layer.provideMerge(servicesLayer));

export {
  driverSupportsAppContext,
  registerCodeItLabContextService,
  resetCodeItLabContextService,
  resolveCodeItLabInstructions,
} from "./turnInjection.ts";
export type { CodeItLabRpcHandlers } from "./rpcHandlers.ts";

import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
  type ServerProvider,
  type ServerProviderModel,
} from "@codeitlab/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";
import { checkpointWorkspace } from "@codeitlab/provider-testing/replayWorkspace";

import * as ServerConfig from "../../config.ts";
import * as EffectWorker from "../../orchestration-v2/EffectWorker.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import { ClaudeProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import * as ProviderReplayHarness from "../../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Routing from "./RoutingService.ts";
import { resetActiveRoutingService } from "./activeRoutingService.ts";
import type * as ProviderAdapter from "@codeitlab/provider-core/server/ProviderAdapter";

/**
 * Regression guard for where OmniRoute enforcement is wired.
 *
 * The routed selection must land on the run a *new* message starts, while a
 * steer into the running turn must keep the selection that message asked for.
 * Before this test existed the resolution lived in `startNextQueuedRun` only, so
 * a first `start_immediately` turn was never routed (the live E2E caught it) and
 * a steer could not be distinguished from a new run.
 *
 * The provider is an in-process fake: no provider CLI runs, but the real
 * orchestrator, effect worker, routing service and event store do.
 */

const driver = ProviderDriverKind.make("claudeAgent");
const instanceId = ProviderInstanceId.make("claudeAgent");
// `routePerTask` picks the smartest model for a coding turn, so the requested
// fast model must differ from the routed one for this guard to mean anything.
const requestedModelSelection = { instanceId, model: "claude-haiku" };
const routedModel = "claude-opus-5-5";

const model = (slug: string, isDefault = false): ServerProviderModel =>
  ({ slug, name: slug, isDefault }) as unknown as ServerProviderModel;

const snapshot = (): ServerProvider =>
  ({
    enabled: true,
    installed: true,
    status: "ready",
    availability: "available",
    auth: { status: "authenticated" },
    models: [model(requestedModelSelection.model), model(routedModel, true)],
  }) as unknown as ServerProvider;

const fakeInstance = {
  instanceId,
  driverKind: driver,
  displayName: "Claude",
  enabled: true,
  snapshot: { getSnapshot: Effect.succeed(snapshot()) },
};

const fakeRegistryLayer = Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
  getInstance: (id: ProviderInstanceId) =>
    Effect.succeed(id === instanceId ? fakeInstance : undefined),
  listInstances: Effect.succeed([fakeInstance]),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  subscribeChanges: Effect.die("unused"),
} as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]);

/** One session per run; `startTurn` keeps the turn running so it can be steered. */
const makeAdapter = (): ProviderAdapter.ProviderAdapterV2["Service"] => ({
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(ClaudeProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: (input) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
      const session = {
        instanceId,
        driver,
        providerSessionId: input.providerSessionId,
        providerSession: {
          id: input.providerSessionId,
          driver,
          providerInstanceId: instanceId,
          status: "ready",
          cwd: process.cwd(),
          model: input.modelSelection.model,
          capabilities: ClaudeProviderCapabilitiesV2,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        },
        events: Stream.fromQueue(events),
        ensureThread: ({ threadId }: { threadId: ThreadId }) =>
          Effect.succeed({
            id: ProviderThreadId.make(`provider-thread:${threadId}`),
            driver,
            providerInstanceId: instanceId,
            providerSessionId: input.providerSessionId,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          }),
        resumeThread: ({ providerThread }: { providerThread: unknown }) =>
          Effect.succeed(providerThread),
        startTurn: (turn: ProviderAdapter.ProviderAdapterV2TurnInput) =>
          Effect.gen(function* () {
            yield* Queue.offer(events, {
              type: "provider_turn.updated",
              driver,
              providerTurn: {
                id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                providerThreadId: turn.providerThread.id,
                nodeId: turn.rootNodeId,
                runAttemptId: turn.attemptId,
                nativeTurnRef: {
                  driver,
                  nativeId: `native:${turn.attemptId}`,
                  strength: "strong",
                },
                ordinal: turn.providerTurnOrdinal,
                status: "running",
                startedAt: now,
                completedAt: null,
              },
            });
          }),
        steerTurn: () => Effect.void,
        interruptTurn: () => Effect.void,
        respondToRuntimeRequest: () => Effect.void,
        readThreadSnapshot: () => Effect.die("unused"),
        rollbackThread: () => Effect.die("unused"),
        forkThread: () => Effect.die("unused"),
      };
      return session as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;
    }),
});

const routing = { mode: "auto", enforcement: "force", recordHistory: true } as const;
const layerDatabase = SqlitePersistence.layerMemory;
const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "codeitlab-enforcement-placement",
});
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EventStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "codeitlab-enforcement-placement" },
    ProviderAdapterRegistry.layerFromAdapters([makeAdapter()]),
    {
      databaseLayer: layerDatabase,
      // The orchestrator reads its own settings service; the routing layer below
      // reads a second one, so both need the same routing block.
      settings: { codeitlab: { routing } },
    },
  ),
  Routing.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerServerConfig,
        ServerSettings.layerTest({ codeitlab: { routing } }),
        fakeRegistryLayer,
        FetchHttpClient.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  ),
).pipe(Layer.provideMerge(layerServerConfig), Layer.provideMerge(NodeServices.layer));

const readHistory = Effect.fn("test.readRoutingHistory")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const historyPath = path.join(config.stateDir, "codeitlab", "routing", "history.jsonl");
  const text = yield* fs.readFileString(historyPath).pipe(Effect.orElseSucceed(() => ""));
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
});

const selectionEventCount = (events: ReadonlyArray<{ event: { type: string } }>) =>
  events.filter((stored) => stored.event.type === "thread.model-selection-updated").length;

it.layer(layerTest)("OmniRoute enforcement placement", (it) => {
  it.effect("a new run adopts the routed model; a steer keeps the requested one", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const eventStore = yield* EventStore.EventStoreV2;
        const workspace = yield* checkpointWorkspace("codeitlab-enforcement-placement");
        const threadId = ThreadId.make("thread:enforcement-placement");

        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("create:enforcement-placement"),
          threadId,
          projectId: ProjectId.make("project:enforcement-placement"),
          title: "Enforcement placement",
          modelSelection: requestedModelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: workspace,
          createdBy: "user",
          creationSource: "web",
        });
        const running = yield* orchestrator.streamDomainEvents.pipe(
          Stream.filter(
            (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
          ),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkScoped,
        );
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("message:enforcement-placement"),
          threadId,
          messageId: MessageId.make("message:enforcement-placement"),
          text: "refactor the parser and add a test",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
        });
        yield* worker.drain();
        yield* Fiber.join(running);

        const projection = yield* orchestrator.getThreadProjection(threadId);
        const run = projection.runs[0];
        assert.ok(run, "the dispatched message started a run");
        assert.strictEqual(run.status, "running");
        assert.strictEqual(run.modelSelection.instanceId, instanceId);
        assert.strictEqual(run.modelSelection.model, routedModel);
        assert.strictEqual(projection.thread.modelSelection.model, routedModel);

        const events = Array.from(yield* eventStore.read({ threadId }).pipe(Stream.runCollect));
        const selectionEvent = events.find(
          (stored) => stored.event.type === "thread.model-selection-updated",
        );
        assert.ok(selectionEvent, "the thread selection event was emitted");
        if (selectionEvent.event.type === "thread.model-selection-updated") {
          assert.strictEqual(selectionEvent.event.payload.modelSelection.model, routedModel);
          assert.strictEqual(selectionEvent.event.providerInstanceId, instanceId);
        }
        const created = events.find((stored) => stored.event.type === "run.created");
        assert.ok(created, "the run was created");
        if (created.event.type === "run.created") {
          assert.strictEqual(created.event.payload.modelSelection.model, routedModel);
        }

        const history = yield* readHistory();
        assert.strictEqual(history.length, 1, "one routing decision per turn");
        assert.strictEqual(history[0]?.enforced, true);
        assert.strictEqual(history[0]?.skipReason, undefined);
        assert.strictEqual(history[0]?.model, routedModel);

        // A steer explicitly asks for the pinned model. Enforcement must not
        // rewrite it to the routed model: that is the difference between the
        // new-run gate and a blanket override.
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("steer:enforcement-placement"),
          threadId,
          messageId: MessageId.make("steer:enforcement-placement"),
          text: "also cover the edge case",
          attachments: [],
          modelSelection: requestedModelSelection,
          dispatchMode: { type: "steer_active", targetRunId: run.id },
        });

        const after = yield* orchestrator.getThreadProjection(threadId);
        assert.strictEqual(
          after.thread.modelSelection.model,
          requestedModelSelection.model,
          "the steer keeps the selection it asked for",
        );
        const historyAfter = yield* readHistory();
        assert.strictEqual(historyAfter.length, 1, "a steer records no routing decision");
        const eventsAfter = Array.from(
          yield* eventStore.read({ threadId }).pipe(Stream.runCollect),
        );
        assert.strictEqual(
          selectionEventCount(eventsAfter),
          2,
          "the steer emits only its own explicit selection change",
        );
      }).pipe(Effect.ensuring(Effect.sync(resetActiveRoutingService))),
    ),
  );
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId, TextGenerationError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";

import { AcpRegistrySettings } from "../settings.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import {
  makeAcpRegistryTextGeneration,
  type AcpRegistryTextGenerationRuntime,
  type AcpRegistryTextGenerationRuntimeFactory,
} from "./textGeneration.ts";

const instanceId = ProviderInstanceId.make("acpRegistry_text_generation_test");
const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const settings = decodeSettings({ source: "local", commandPath: "fake-acp", enabled: true });

const catalog: AcpRegistrySupport.AcpRegistryCatalog["Service"] = {
  search: () => Effect.die("unused search"),
  prepare: () => Effect.die("unused prepare"),
  inspect: () => Effect.die("unused inspect"),
  resolve: () =>
    Effect.succeed({
      distribution: "local",
      spawn: { command: "fake-acp", args: [] },
    }),
  uninstallManagedBinary: () => Effect.die("unused uninstall"),
};

const modelOption: EffectAcpSchema.SessionConfigOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "model-a",
  options: [{ value: "model-a", name: "Model A" }],
};

interface FakeRuntimeOptions {
  readonly chunks?: ReadonlyArray<string>;
  readonly promptFailure?: EffectAcpErrors.AcpError;
  readonly hang?: Deferred.Deferred<void>;
  readonly configOptions?: ReadonlyArray<EffectAcpSchema.SessionConfigOption>;
  readonly availableModels?: ReadonlyArray<{
    readonly modelId: string;
    readonly name: string;
  }>;
}

const makeHarness = Effect.fn("TextGenerationTest.makeHarness")(function* (
  options: FakeRuntimeOptions = {},
) {
  const disposed = yield* Ref.make(false);
  const selectedModels = yield* Ref.make<ReadonlyArray<string>>([]);
  const selectedSessionModels = yield* Ref.make<ReadonlyArray<string>>([]);
  const promptedTexts = yield* Ref.make<ReadonlyArray<string>>([]);
  const updateHandlers = yield* Ref.make<
    ReadonlyArray<Parameters<AcpRegistryTextGenerationRuntime["handleSessionUpdate"]>[0]>
  >([]);

  const sessionId = "fake-session";
  const started = {
    sessionId,
    initializeResult: {
      protocolVersion: 2,
      agentCapabilities: {},
      authMethods: [],
    },
    sessionSetupResult: {
      sessionId,
      ...(options.availableModels === undefined
        ? {}
        : {
            models: {
              currentModelId: options.availableModels[0]?.modelId ?? "model-a",
              availableModels: options.availableModels,
            },
          }),
    },
    modelConfigId: undefined,
  } satisfies AcpSessionRuntime.AcpSessionRuntimeStartResult;

  const makeRuntime: AcpRegistryTextGenerationRuntimeFactory = () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      yield* Scope.addFinalizer(scope, Ref.set(disposed, true));
      const runtime: AcpRegistryTextGenerationRuntime = {
        handleSessionUpdate: (handler) =>
          Ref.update(updateHandlers, (current) => [...current, handler]),
        handleElicitation: () => Effect.void,
        start: () => Effect.succeed(started),
        getConfigOptions: Effect.succeed(options.configOptions ?? []),
        setModel: (model) => Ref.update(selectedModels, (current) => [...current, model]),
        setSessionModel: (model) =>
          Ref.update(selectedSessionModels, (current) => [...current, model]).pipe(Effect.as({})),
        prompt: (payload) =>
          Effect.gen(function* () {
            const text = payload.prompt
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join("");
            yield* Ref.update(promptedTexts, (current) => [...current, text]);
            const handlers = yield* Ref.get(updateHandlers);
            for (const chunk of options.chunks ?? []) {
              for (const handler of handlers) {
                yield* handler({
                  sessionId,
                  update: {
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: chunk },
                  },
                });
              }
            }
            if (options.promptFailure !== undefined) return yield* options.promptFailure;
            if (options.hang !== undefined) {
              yield* Deferred.succeed(options.hang, undefined);
              return yield* Effect.never;
            }
            return { stopReason: "end_turn" as const };
          }),
      };
      return runtime;
    });

  const generation = yield* makeAcpRegistryTextGeneration(
    { instanceId, settings, environment: {} },
    { makeRuntime },
  ).pipe(
    Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog),
    Effect.provide(NodeServices.layer),
  );

  return {
    generation,
    disposed,
    selectedModels,
    selectedSessionModels,
    promptedTexts,
  };
});

const titleInput = {
  cwd: "/workspace",
  message: "hi",
  modelSelection: { instanceId, model: "model-a" },
} as const;

describe("ACP Registry text generation", () => {
  it.effect("returns the assistant text from a disposable session as the thread title", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        chunks: ["Hello ", "from ACP"],
        configOptions: [modelOption],
      });

      const generated = yield* harness.generation.generateThreadTitle(titleInput);

      expect(generated).toEqual({ title: "Hello from ACP" });
      expect(yield* Ref.get(harness.promptedTexts)).toEqual(["hi"]);
      expect(yield* Ref.get(harness.selectedModels)).toEqual(["model-a"]);
      expect(yield* Ref.get(harness.disposed)).toBe(true);
    }),
  );

  it.effect("falls back to 'hi' when the agent returns no text", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ chunks: ["   "] });
      const generated = yield* harness.generation.generateThreadTitle(titleInput);
      expect(generated).toEqual({ title: "hi" });
    }),
  );

  it.effect(
    "selects the requested model from the session model state when there is no option",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          availableModels: [{ modelId: "model-b", name: "Model B" }],
        });

        yield* harness.generation.generateThreadTitle({
          ...titleInput,
          modelSelection: { instanceId, model: "model-b" },
        });

        expect(yield* Ref.get(harness.selectedSessionModels)).toEqual(["model-b"]);
        expect(yield* Ref.get(harness.selectedModels)).toEqual([]);
      }),
  );

  it.effect("wraps a failed turn in a TextGenerationError and disposes the session", () =>
    Effect.gen(function* () {
      const cause = new EffectAcpErrors.AcpTransportError({
        detail: "connection lost",
        cause: undefined,
      });
      const harness = yield* makeHarness({ promptFailure: cause });

      const error = yield* harness.generation.generateThreadTitle(titleInput).pipe(Effect.flip);

      expect(error).toBeInstanceOf(TextGenerationError);
      expect(error.operation).toBe("generateThreadTitle");
      expect(error.detail).toContain("fake-acp");
      expect(error.detail).toContain(instanceId);
      expect(error.detail).toContain("could not complete the text generation turn.");
      expect(error.cause).toBe(cause);
      expect(yield* Ref.get(harness.disposed)).toBe(true);
    }),
  );

  it.effect("times out a hanging turn and disposes the session", () =>
    Effect.gen(function* () {
      const hang = yield* Deferred.make<void>();
      const harness = yield* makeHarness({ hang });

      const pending = yield* harness.generation
        .generateThreadTitle(titleInput)
        .pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(hang);
      yield* TestClock.adjust("20 seconds");
      const error = yield* Fiber.join(pending);

      expect(error).toBeInstanceOf(TextGenerationError);
      expect(error.operation).toBe("generateThreadTitle");
      expect(error.detail).toContain("did not complete text generation within 20s");
      expect(yield* Ref.get(harness.disposed)).toBe(true);
    }),
  );

  it.effect("keeps the other text generation operations unsupported", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness.generation
        .generateCommitMessage({
          cwd: "/workspace",
          branch: "main",
          stagedSummary: "M README.md",
          stagedPatch: "diff --git a/README.md b/README.md",
          modelSelection: { instanceId, model: "model-a" },
        })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(TextGenerationError);
      expect(error.operation).toBe("generateCommitMessage");
      expect(error.detail).toContain("only thread-title text generation is available");
    }),
  );
});

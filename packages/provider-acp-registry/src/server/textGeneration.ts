import { TextGenerationError, type ProviderInstanceId } from "@codeitlab/contracts";
import { readCustomModelEntries } from "@codeitlab/shared/model";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import * as AcpSessionRuntime from "@codeitlab/provider-acp/server/AcpSessionRuntime";
import { findModelConfigOption } from "@codeitlab/provider-acp/server/runtimeModel";
import type { ProviderTextGeneration } from "@codeitlab/provider-core/server/textGeneration";
import { decodeJsonReply } from "@codeitlab/provider-core/server/textGenerationOperations";
import { buildThreadPurposePrompt } from "@codeitlab/provider-core/server/textGenerationPrompts";
import { sanitizeThreadPurpose } from "@codeitlab/provider-core/server/textGenerationUtils";
import { extractJsonObject } from "@codeitlab/shared/schemaJson";
import type { AcpRegistrySettings } from "../settings.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";

/**
 * The routing speed probe sends a one-word turn through `generateThreadTitle`,
 * so the bound has to cover an agent cold start, not just model latency.
 */
const TEXT_GENERATION_TIMEOUT = Duration.seconds(20);
const CLIENT_INFO = { name: "codeitlab-text-generation", version: "0.0.0" } as const;

type TextGenerationOperation = keyof ProviderTextGeneration;

/**
 * The slice of `AcpSessionRuntime` this one-shot turn needs. Narrowing it keeps
 * the disposable-session flow testable without spawning a real ACP agent.
 */
export interface AcpRegistryTextGenerationRuntime {
  readonly handleSessionUpdate: (
    handler: (
      notification: EffectAcpSchema.SessionNotification,
    ) => Effect.Effect<void, EffectAcpErrors.AcpError>,
  ) => Effect.Effect<void>;
  readonly handleElicitation: (
    handler: (
      request: EffectAcpSchema.CreateElicitationRequest,
    ) => Effect.Effect<EffectAcpSchema.CreateElicitationResponse, EffectAcpErrors.AcpError>,
  ) => Effect.Effect<void>;
  readonly start: () => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntimeStartResult,
    EffectAcpErrors.AcpError
  >;
  readonly getConfigOptions: Effect.Effect<ReadonlyArray<EffectAcpSchema.SessionConfigOption>>;
  readonly setModel: (model: string) => Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly setSessionModel: (
    model: string,
  ) => Effect.Effect<EffectAcpSchema.SetSessionModelResponse, EffectAcpErrors.AcpError>;
  readonly prompt: (
    payload: Omit<EffectAcpSchema.PromptRequest, "sessionId">,
  ) => Effect.Effect<EffectAcpSchema.PromptResponse, EffectAcpErrors.AcpError>;
}

export interface AcpRegistryTextGenerationRuntimeInput {
  readonly cwd: string;
  readonly settings: AcpRegistrySettings;
  readonly resolved: AcpRegistrySupport.ResolvedAcpRegistryAgent;
}

export type AcpRegistryTextGenerationRuntimeFactory = (
  input: AcpRegistryTextGenerationRuntimeInput,
) => Effect.Effect<
  AcpRegistryTextGenerationRuntime,
  EffectAcpErrors.AcpError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
>;

export interface AcpRegistryTextGenerationOptions {
  readonly instanceId: ProviderInstanceId;
  readonly settings: AcpRegistrySettings;
  readonly environment: NodeJS.ProcessEnv;
}

export interface AcpRegistryTextGenerationDependencies {
  /** Test seam: replace the disposable `AcpSessionRuntime` with a fake. */
  readonly makeRuntime?: AcpRegistryTextGenerationRuntimeFactory;
  readonly timeout?: Duration.Input;
}

const providerLabel = (settings: AcpRegistrySettings): string =>
  settings.source === "local"
    ? settings.commandPath.trim() || "local ACP command"
    : settings.agentId.trim() || "ACP Registry agent";

const makeDisposableRuntime: AcpRegistryTextGenerationRuntimeFactory = Effect.fn(
  "AcpRegistryTextGeneration.makeDisposableRuntime",
)(function* (input: AcpRegistryTextGenerationRuntimeInput) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      spawn: input.resolved.spawn,
      cwd: input.cwd,
      clientCapabilities: {
        // A disposable turn must never open a login terminal, write files, or
        // run interactive commands on behalf of the user.
        auth: { terminal: false },
        elicitation: { url: {} },
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: CLIENT_INFO,
      // Surface an auth-required failure instead of starting an interactive login.
      authenticateOnAuthRequired: false,
      ...(input.settings.authMethodId ? { authMethodId: input.settings.authMethodId } : {}),
      customModels: readCustomModelEntries(input.settings.customModels).map((entry) => entry.slug),
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Layer.succeed(Crypto.Crypto, crypto),
        ),
      ),
    ),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
});

export const makeAcpRegistryTextGeneration = Effect.fn("AcpRegistryTextGeneration.make")(function* (
  options: AcpRegistryTextGenerationOptions,
  dependencies: AcpRegistryTextGenerationDependencies = {},
): Effect.fn.Return<
  ProviderTextGeneration,
  never,
  AcpRegistrySupport.AcpRegistryCatalog | ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const makeRuntime = dependencies.makeRuntime ?? makeDisposableRuntime;
  const timeout = Duration.fromInputUnsafe(dependencies.timeout ?? TEXT_GENERATION_TIMEOUT);
  const provider = providerLabel(options.settings);
  const customModels = new Set(
    readCustomModelEntries(options.settings.customModels).map((entry) => entry.slug),
  );

  const failure = (operation: TextGenerationOperation, detail: string, cause?: unknown) =>
    new TextGenerationError({
      operation,
      detail: `${provider} (${options.instanceId}): ${detail}`,
      ...(cause === undefined ? {} : { cause }),
    });

  const applyRequestedModel = Effect.fn("AcpRegistryTextGeneration.applyRequestedModel")(function* (
    runtime: AcpRegistryTextGenerationRuntime,
    started: AcpSessionRuntime.AcpSessionRuntimeStartResult,
    requestedModel: string,
  ): Effect.fn.Return<void, EffectAcpErrors.AcpError> {
    const model = requestedModel.trim();
    if (model.length === 0) return;
    // Agents without a model option run their default model; asking them to
    // select one would fail the turn for no benefit.
    const modelOption = findModelConfigOption(yield* runtime.getConfigOptions);
    if (modelOption !== undefined) {
      yield* runtime.setModel(model);
      return;
    }
    const modelState = started.sessionSetupResult.models;
    if (
      modelState != null &&
      (customModels.has(model) ||
        modelState.availableModels.some((candidate) => candidate.modelId === model))
    ) {
      yield* runtime.setSessionModel(model);
    }
  });

  const runOneShot = Effect.fn("AcpRegistryTextGeneration.runOneShot")(function* (
    operation: TextGenerationOperation,
    input: {
      readonly cwd: string;
      readonly prompt: string;
      readonly model: string;
    },
  ): Effect.fn.Return<string, TextGenerationError> {
    return yield* Effect.gen(function* () {
      const resolved = yield* catalog
        .resolve(options.settings, input.cwd, options.environment)
        .pipe(
          Effect.mapError((cause) =>
            failure(operation, "could not resolve the ACP agent executable.", cause),
          ),
        );
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makeRuntime({
            cwd: input.cwd,
            settings: options.settings,
            resolved,
          }).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.mapError((cause) =>
              failure(operation, "could not start a disposable ACP session.", cause),
            ),
          );
          const output = yield* Ref.make("");
          yield* runtime.handleSessionUpdate((notification) => {
            const update = notification.update;
            if (update.sessionUpdate !== "agent_message_chunk") return Effect.void;
            const content = update.content;
            if (content.type !== "text") return Effect.void;
            return Ref.update(output, (current) => current + content.text);
          });
          // No human is attached to this session, so every prompt is declined
          // rather than surfaced as an interactive request.
          yield* runtime.handleElicitation(() => Effect.succeed({ action: "decline" } as const));
          const started = yield* runtime
            .start()
            .pipe(
              Effect.mapError((cause) => failure(operation, "could not open a session.", cause)),
            );
          yield* applyRequestedModel(runtime, started, input.model).pipe(
            Effect.mapError((cause) =>
              failure(operation, `could not select model '${input.model}'.`, cause),
            ),
          );
          yield* runtime
            .prompt({ prompt: [{ type: "text", text: input.prompt }] })
            .pipe(
              Effect.mapError((cause) =>
                failure(operation, "could not complete the text generation turn.", cause),
              ),
            );
          return yield* Ref.get(output);
        }),
      );
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            failure(
              operation,
              `did not complete text generation within ${Duration.format(timeout)}.`,
            ),
          ),
      }),
    );
  });

  const unsupported = (operation: TextGenerationOperation) =>
    Effect.fail(
      failure(
        operation,
        "only thread-title and thread-purpose text generation are available for ACP Registry instances.",
      ),
    );

  const generateThreadTitle: ProviderTextGeneration["generateThreadTitle"] = Effect.fn(
    "AcpRegistryTextGeneration.generateThreadTitle",
  )(function* (input) {
    const text = yield* runOneShot("generateThreadTitle", {
      cwd: input.cwd,
      prompt: input.message,
      model: input.modelSelection.model,
    });
    return { title: text.trim() || "hi" };
  });

  const generateThreadPurpose: ProviderTextGeneration["generateThreadPurpose"] = Effect.fn(
    "AcpRegistryTextGeneration.generateThreadPurpose",
  )(function* (input) {
    const prompt = buildThreadPurposePrompt({ threadContext: input.threadContext });
    const text = yield* runOneShot("generateThreadPurpose", {
      cwd: input.cwd,
      prompt: prompt.prompt,
      model: input.modelSelection.model,
    });
    // ACP agents answer in prose far more often than in the requested JSON, and
    // the purpose is a one-liner either way, so a decode failure is not worth
    // failing the feature over.
    const decoded = yield* decodeJsonReply(
      { operation: "generateThreadPurpose", outputSchema: prompt.outputSchema },
      "ACP Registry",
      text,
    ).pipe(Effect.orElseSucceed(() => ({ purpose: extractJsonObject(text) })));
    return { purpose: sanitizeThreadPurpose(decoded.purpose) };
  });

  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle,
    generateThreadPurpose,
    generateReviewGuide: () => unsupported("generateReviewGuide"),
    generateDeliveryHandoff: () => unsupported("generateDeliveryHandoff"),
  } satisfies ProviderTextGeneration;
});

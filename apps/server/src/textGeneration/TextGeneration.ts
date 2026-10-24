import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";

import * as ServerSettings from "../serverSettings.ts";
import { guardProviderPrompt, restoreAppTurnFakes } from "../codeitlab/credentials/promptGuard.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";

export type {
  BranchNameGenerationInput,
  BranchNameGenerationResult,
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  PrContentGenerationInput,
  PrContentGenerationResult,
  ReviewGuideGenerationInput,
  ReviewGuideGenerationResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "codeitlab/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateReviewGuide";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;

  /**
   * Every app-initiated generation (title, commit message, PR body, branch
   * name, review guide) sends user content to a provider without going through
   * the turn dispatch path, so it needs the same mask/restore as a turn.
   */
  const masker = Effect.fn("TextGeneration.masker")(function* () {
    // Read at call time: the settings service is in the runtime context, and a
    // missing one (unit tests, early startup) fails open like the turn guard.
    const settingsService = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
    if (Option.isNone(settingsService)) return (text: string) => text;
    const current = yield* settingsService.value.getSettings.pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const credentials = current?.codeitlab.credentials;
    if (credentials === undefined || !credentials.enabled) {
      return (text: string) => text;
    }
    return (text: string) => guardProviderPrompt(credentials, text).text;
  });
  return TextGeneration.of({
    generateCommitMessage: Effect.fn("TextGeneration.generateCommitMessage")(function* (input) {
      const mask = yield* masker();
      const result = yield* resolveInstance(
        registry,
        "generateCommitMessage",
        input.modelSelection.instanceId,
      ).pipe(
        Effect.flatMap((textGeneration) =>
          textGeneration.generateCommitMessage({
            ...input,
            stagedSummary: mask(input.stagedSummary),
            stagedPatch: mask(input.stagedPatch),
          }),
        ),
      );
      return restoreAppTurnFakes(result);
    }),
    generatePrContent: Effect.fn("TextGeneration.generatePrContent")(function* (input) {
      const mask = yield* masker();
      const result = yield* resolveInstance(
        registry,
        "generatePrContent",
        input.modelSelection.instanceId,
      ).pipe(
        Effect.flatMap((textGeneration) =>
          textGeneration.generatePrContent({
            ...input,
            commitSummary: mask(input.commitSummary),
            diffSummary: mask(input.diffSummary),
            diffPatch: mask(input.diffPatch),
            ...(input.changeRequestTemplate === undefined
              ? {}
              : { changeRequestTemplate: mask(input.changeRequestTemplate) }),
            ...(input.threadContext === undefined
              ? {}
              : { threadContext: mask(input.threadContext) }),
          }),
        ),
      );
      return restoreAppTurnFakes(result);
    }),
    generateBranchName: Effect.fn("TextGeneration.generateBranchName")(function* (input) {
      const mask = yield* masker();
      const result = yield* resolveInstance(
        registry,
        "generateBranchName",
        input.modelSelection.instanceId,
      ).pipe(
        Effect.flatMap((textGeneration) =>
          textGeneration.generateBranchName({ ...input, message: mask(input.message) }),
        ),
      );
      return restoreAppTurnFakes(result);
    }),
    generateReviewGuide: Effect.fn("TextGeneration.generateReviewGuide")(function* (input) {
      const mask = yield* masker();
      const result = yield* resolveInstance(
        registry,
        "generateReviewGuide",
        input.modelSelection.instanceId,
      ).pipe(
        Effect.flatMap((textGeneration) =>
          textGeneration.generateReviewGuide({
            ...input,
            title: mask(input.title),
            description: mask(input.description),
            settledReview: mask(input.settledReview),
            ...(input.instructions === undefined ? {} : { instructions: mask(input.instructions) }),
            ...(input.stack === undefined
              ? {}
              : {
                  stack: input.stack.map((layer) => ({
                    ...layer,
                    title: layer.title === null ? null : mask(layer.title),
                  })),
                }),
          }),
        ),
      );
      return restoreAppTurnFakes(result);
    }),
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function* (input) {
      const mask = yield* masker();
      const textGeneration = yield* resolveInstance(
        registry,
        "generateThreadTitle",
        input.modelSelection.instanceId,
      );
      const linkedContext =
        input.linkedContext ??
        (yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
          Effect.provideService(
            SourceControlProviderRegistry.SourceControlProviderRegistry,
            sourceControl,
          ),
        ));
      const result = yield* textGeneration.generateThreadTitle({
        ...input,
        message: mask(input.message),
        ...(linkedContext === undefined ? {} : { linkedContext: mask(linkedContext) }),
        ...(input.previousTitle === undefined ? {} : { previousTitle: mask(input.previousTitle) }),
      });
      return restoreAppTurnFakes(result);
    }),
  });
});

export const layer = Layer.effect(TextGeneration, make);

import type { RunId, ThreadId } from "@codeitlab/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as MemoryExtraction from "../codeitlab/memory/MemoryExtractionService.ts";
import * as Soul from "../codeitlab/memory/Soul.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * Post-turn memory. The orchestrator enqueues `memory.extract-turn` when a run
 * completes, so extraction never sits on the orchestrator's transaction or on the
 * provider turn's critical path — the same reason thread title regeneration is an
 * effect rather than inline work.
 *
 * This service is what makes `autoExtract` reachable from a real turn. Without
 * it nothing called `extractTurn`, so the setting was dead config and the agent
 * never wrote a memory of its own.
 */
export class MemoryTurnExtractionService extends Context.Service<
  MemoryTurnExtractionService,
  {
    readonly extract: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
    }) => Effect.Effect<void>;
  }
>()("codeitlab/orchestration-v2/MemoryTurnExtractionService") {}

type ExtractInput = { readonly threadId: ThreadId; readonly runId: RunId };

/**
 * The run's user prompt and the assistant text that answered it. A turn can
 * produce several assistant messages (narration, then the answer), so joining
 * them keeps extraction from reading half a reply as a complete fact.
 */
const conversationSlice = (
  messages: ReadonlyArray<{
    readonly runId: RunId | null;
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
    readonly streaming: boolean;
  }>,
  runId: RunId,
) => {
  const settled = messages.filter((message) => !message.streaming);
  const runMessages = settled.filter((message) => message.runId === runId);
  const prompt =
    runMessages.find((message) => message.role === "user")?.text ??
    settled.findLast((message) => message.role === "user")?.text ??
    "";
  const assistantText = runMessages
    .filter((message) => message.role === "assistant")
    .map((message) => message.text)
    .join("\n\n");
  return { prompt, assistantText };
};

export const layer = Layer.effect(
  MemoryTurnExtractionService,
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const extraction = yield* MemoryExtraction.MemoryExtractionService;
    // The soul files are an optional projection of the corpus. Reading it as an
    // option keeps the executor layer's requirement at the extraction service
    // alone, so every harness that already mocks extraction needs no new wiring.
    const soul = yield* Effect.serviceOption(Soul.Soul);

    const extract = Effect.fn("MemoryTurnExtractionService.extract")(function* (
      input: ExtractInput,
    ) {
      const projection = yield* projections.getThreadProjection(input.threadId).pipe(
        // A thread deleted between the turn completing and this effect running
        // has no conversation left to learn from; that is not a failure.
        Effect.catch(() => Effect.succeed(undefined)),
      );
      if (projection === undefined) return;

      const { prompt, assistantText } = conversationSlice(projection.messages, input.runId);
      if (prompt.trim().length === 0) return;

      yield* extraction.extractTurn({
        threadId: input.threadId,
        projectId: projection.thread.projectId,
        prompt,
        assistantText,
      });

      // Render the human-readable half right after the corpus changes, so the files
      // a user reads always match what the next turn will recall.
      yield* Option.match(soul, {
        onNone: () => Effect.void,
        onSome: (service) => service.refresh,
      });
    });

    const extractOrIgnoreFailure = (input: ExtractInput) =>
      extract(input).pipe(
        // Memory is an enhancement, never a correctness requirement for a turn
        // the user already got an answer from. A broken store must not surface
        // as a failed effect and block the outbox for that thread.
        Effect.catchCause((cause) =>
          Effect.logWarning("Memory extraction failed; the turn itself succeeded.", {
            threadId: input.threadId,
            cause,
          }),
        ),
      );

    return { extract: extractOrIgnoreFailure };
  }),
);

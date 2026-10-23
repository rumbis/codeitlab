import type { MemoryEntry } from "@codeitlab/core/memory";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../../serverSettings.ts";
import { extractMemoryCandidates } from "./extraction.ts";
import { MemoryStore } from "./MemoryStore.ts";

/**
 * Post-turn extraction. The turn-finalization hook calls `extractTurn` after a
 * turn settles (never inside the orchestrator transaction); it is deliberately
 * not part of the public `MemoryService` tag because no client RPC triggers it.
 *
 * Extraction is best-effort: a failed write logs and returns what it managed to
 * store, so a broken memory store can never fail a completed turn.
 */

export interface MemoryTurnInput {
  readonly threadId?: string | undefined;
  readonly projectId?: string | null | undefined;
  readonly prompt: string;
  readonly assistantText?: string | undefined;
}

export class MemoryExtractionService extends Context.Service<
  MemoryExtractionService,
  {
    readonly extractTurn: (
      input: MemoryTurnInput,
    ) => Effect.Effect<ReadonlyArray<MemoryEntry>, never>;
  }
>()("t3/codeitlab/memory/MemoryExtractionService") {}

export const make = Effect.fn("codeitlab.memory.extraction.make")(function* () {
  const store = yield* MemoryStore;
  const settings = yield* ServerSettings.ServerSettingsService;

  const extractTurn = Effect.fn("codeitlab.memory.extractTurn")(function* (input: MemoryTurnInput) {
    const current = yield* settings.getSettings.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Memory extraction skipped: settings unavailable.", { cause }).pipe(
          Effect.as(undefined),
        ),
      ),
    );
    if (current === undefined) return [];
    const memorySettings = current.codeitlab.memory;
    if (!memorySettings.enabled || !memorySettings.autoExtract) return [];

    const candidates = extractMemoryCandidates({
      prompt: input.prompt,
      assistantText: input.assistantText,
    });
    if (candidates.length === 0) return [];

    const projectId = input.projectId ?? null;
    const scope =
      memorySettings.defaultScope === "project" && projectId !== null ? "project" : "global";
    const stored: MemoryEntry[] = [];
    for (const candidate of candidates) {
      const result = yield* store
        .add({
          scope,
          projectId: scope === "project" ? projectId : null,
          kind: candidate.kind,
          text: candidate.text,
          tags: candidate.tags,
          confidence: candidate.confidence,
          source: "turn",
          maxEntries: memorySettings.maxEntries,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Memory extraction skipped a candidate.", { cause }).pipe(
              Effect.as(undefined),
            ),
          ),
        );
      if (result !== undefined) stored.push(result.entry);
    }

    if (stored.length > 0) {
      const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
      yield* store
        .setLastExtractionAt(at)
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Failed to record the memory extraction timestamp.", { cause }),
          ),
        );
    }
    return stored;
  });

  return MemoryExtractionService.of({ extractTurn });
});

export const layer = Layer.effect(MemoryExtractionService, make());

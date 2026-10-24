import { CodeitlabServiceError } from "@codeitlab/core";
import type {
  MemoryEntry,
  MemoryRecall,
  MemorySearchHit,
  MemorySearchInput,
} from "@codeitlab/core/memory";
import { MemoryService as MemoryServiceTag } from "@codeitlab/core/services";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../../serverSettings.ts";
import * as MemoryExtraction from "./MemoryExtractionService.ts";
import { MemoryStore } from "./MemoryStore.ts";
import { layer as memoryStoreLayer } from "./MemoryStore.ts";
import * as MemoryTransfer from "./MemoryTransfer.ts";
import { redactSecrets } from "./redaction.ts";
import { filterMemoriesForScope, rankMemoryEntries, renderMemoryRecall } from "./retrieval.ts";

const MAX_INJECTED_CHARS = 2_000;

const addError = (message: string, cause?: unknown): CodeitlabServiceError =>
  new CodeitlabServiceError({
    operation: "memory.add",
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const updateError = (message: string, cause?: unknown): CodeitlabServiceError =>
  new CodeitlabServiceError({
    operation: "memory.update",
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const secretRejection = (operation: "memory.add" | "memory.update", cause?: unknown) =>
  new CodeitlabServiceError({
    operation,
    message: "Memory rejected a value that looks like a credential. Secrets are never stored.",
    ...(cause === undefined ? {} : { cause }),
  });

export const make = Effect.fn("codeitlab.memory.service.make")(function* () {
  const store = yield* MemoryStore;
  const settings = yield* ServerSettings.ServerSettingsService;

  const list = Effect.fn("codeitlab.memory.list")(function* (
    input: {
      readonly scope?: "global" | "project";
      readonly projectId?: string | null;
      readonly limit?: number;
    } = {},
  ) {
    const entries = yield* store.read;
    const visible = filterMemoriesForScope(entries, {
      scope: input.scope,
      projectId: input.projectId,
    });
    return [...visible]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, input.limit ?? 200);
  });

  const search = Effect.fn("codeitlab.memory.search")(function* (input: MemorySearchInput) {
    const [entries, nowMs] = yield* Effect.all([store.read, Clock.currentTimeMillis]);
    const visible = filterMemoriesForScope(entries, { projectId: input.projectId });
    return rankMemoryEntries(visible, input.query, {
      nowMs,
      limit: input.limit ?? 20,
      minScore: input.minScore ?? 0,
    });
  });

  const add = Effect.fn("codeitlab.memory.add")(function* (input: {
    readonly scope: "global" | "project";
    readonly projectId?: string | null;
    readonly kind: MemoryEntry["kind"];
    readonly text: string;
    readonly tags?: ReadonlyArray<string>;
    readonly confidence?: number;
    readonly source?: MemoryEntry["source"];
  }) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError((cause) => addError("Could not read settings before writing memory.", cause)),
    );
    const memorySettings = current.codeitlab.memory;
    if (!memorySettings.enabled) {
      return yield* Effect.fail(addError("Memory is disabled in settings."));
    }
    const redaction = redactSecrets(input.text);
    if (redaction.redacted) {
      return yield* Effect.fail(secretRejection("memory.add"));
    }
    const result = yield* store
      .add({
        scope: input.scope,
        projectId: input.scope === "project" ? (input.projectId ?? null) : null,
        kind: input.kind,
        text: input.text,
        tags: input.tags ?? [],
        confidence: input.confidence ?? 0.8,
        source: input.source ?? "manual",
        maxEntries: memorySettings.maxEntries,
      })
      .pipe(
        Effect.catchTags({
          MemorySecretRejectedError: (cause) => Effect.fail(secretRejection("memory.add", cause)),
          MemoryValidationError: (cause) => Effect.fail(addError(cause.reason, cause)),
          MemoryStoreError: (cause) =>
            Effect.fail(addError("Failed to write the memory store.", cause)),
        }),
      );
    return result.entry;
  });

  const update = Effect.fn("codeitlab.memory.update")(function* (
    id: string,
    patch: { readonly text?: string; readonly tags?: ReadonlyArray<string> },
  ) {
    if (patch.text !== undefined && redactSecrets(patch.text).redacted) {
      return yield* Effect.fail(secretRejection("memory.update"));
    }
    return yield* store.update(id, patch).pipe(
      Effect.catchTags({
        MemoryNotFoundError: (cause) => Effect.fail(updateError(cause.message, cause)),
        MemorySecretRejectedError: (cause) => Effect.fail(secretRejection("memory.update", cause)),
        MemoryValidationError: (cause) => Effect.fail(updateError(cause.reason, cause)),
        MemoryStoreError: (cause) =>
          Effect.fail(updateError("Failed to write the memory store.", cause)),
      }),
    );
  });

  const remove = Effect.fn("codeitlab.memory.remove")(function* (id: string) {
    yield* store.remove(id).pipe(
      Effect.mapError(
        (cause) =>
          new CodeitlabServiceError({
            operation: "memory.remove",
            message: "Failed to write the memory store.",
            cause,
          }),
      ),
    );
  });

  const recall = Effect.fn("codeitlab.memory.recall")(function* (input: {
    readonly query: string;
    readonly projectId?: string | null;
    readonly limit?: number;
    readonly minScore?: number;
  }) {
    const empty: MemoryRecall = { query: input.query, hits: [], injectedText: "" };
    const current = yield* settings.getSettings.pipe(Effect.option);
    if (Option.isNone(current)) return empty;
    const memorySettings = current.value.codeitlab.memory;
    if (!memorySettings.enabled || !memorySettings.autoRecall) return empty;

    const [entries, nowMs] = yield* Effect.all([store.read, Clock.currentTimeMillis]);
    const visible = filterMemoriesForScope(entries, { projectId: input.projectId ?? null });
    const hits = rankMemoryEntries(visible, input.query, {
      nowMs,
      limit: input.limit ?? memorySettings.retrievalTopK,
      minScore: input.minScore ?? memorySettings.minScore,
    });
    const rendered = renderMemoryRecall(input.query, hits);
    // Cap the injected text by dropping the weakest hits rather than truncating
    // a memory mid-sentence, which would read as a corrupted fact.
    let injectedHits: ReadonlyArray<MemorySearchHit> = rendered.hits;
    let injectedText = rendered.injectedText;
    while (injectedText.length > MAX_INJECTED_CHARS && injectedHits.length > 0) {
      injectedHits = injectedHits.slice(0, -1);
      injectedText = renderMemoryRecall(input.query, injectedHits).injectedText;
    }
    yield* store.recordRecalls(injectedHits.map((hit) => hit.entry.id)).pipe(
      // A recall is a read path; a failed counter write must not fail a turn.
      Effect.catch((cause) => Effect.logWarning("Failed to record memory recalls.", { cause })),
    );
    return { query: input.query, hits: injectedHits, injectedText };
  });

  return MemoryServiceTag.of({
    list,
    search,
    add,
    update,
    remove,
    stats: store.stats,
    recall,
  });
});

export const layer = Layer.effect(MemoryServiceTag, make());

/**
 * One store shared by the read/write service, the post-turn extractor and the
 * export/import service. `Layer.provideMerge` re-exports the store so every
 * consumer sees the same instance instead of constructing its own file-backed
 * copy.
 */
export const memoryLayer = Layer.mergeAll(layer, MemoryExtraction.layer, MemoryTransfer.layer).pipe(
  Layer.provideMerge(memoryStoreLayer),
);

export { MemoryExtractionService } from "./MemoryExtractionService.ts";
export { MemoryTransferService } from "./MemoryTransfer.ts";
export {
  MemoryNotFoundError,
  MemorySecretRejectedError,
  MemoryStore,
  MemoryStoreError,
  MemoryValidationError,
} from "./MemoryStore.ts";
export {
  decodeMemoryExport,
  mergeImportedMemories,
  parseMemoryExport,
  serializeMemoryExport,
} from "./export.ts";
export {
  extractMemoryCandidates,
  isNearDuplicateMemory,
  memoryTextKey,
  normalizeMemoryText,
} from "./extraction.ts";
export { filterMemoriesForScope, rankMemoryEntries, tokenizeMemoryText } from "./retrieval.ts";
export { containsSecret, redactSecrets } from "./redaction.ts";

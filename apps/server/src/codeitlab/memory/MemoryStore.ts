import { MemoryEntry, type MemoryStats } from "@codeitlab/core/memory";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

import * as ServerConfig from "../../config.ts";
import { isNearDuplicateMemory, normalizeMemoryText } from "./extraction.ts";

/**
 * Durable memory storage: one JSONL file plus a small meta file under
 * `<stateDir>/codeitlab/memory/`. The whole corpus is held in memory because
 * `maxEntries` bounds it; a turn's recall is a scan over a few thousand short
 * strings, which is cheaper than maintaining an FTS index across processes.
 *
 * Writes are serialized and atomic (temp file + rename) so a crash mid-write
 * cannot truncate the corpus.
 */

const MemoryMeta = Schema.Struct({
  lastExtractionAt: Schema.NullOr(Schema.String),
});
type MemoryMeta = typeof MemoryMeta.Type;

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(MemoryEntry));
const encodeLine = Schema.encodeSync(Schema.fromJsonString(MemoryEntry));
const decodeMeta = Schema.decodeUnknownOption(Schema.fromJsonString(MemoryMeta));
const encodeMeta = Schema.encodeSync(Schema.fromJsonString(MemoryMeta));

export const MAX_MEMORY_TEXT_LENGTH = 2_000;

export class MemoryStoreError extends Schema.TaggedError<MemoryStoreError>()("MemoryStoreError", {
  operation: Schema.Literals(["load", "persist", "add", "update", "remove", "import"]),
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Memory store failed to ${this.operation} at ${this.path}.`;
  }
}

export class MemorySecretRejectedError extends Schema.TaggedError<MemorySecretRejectedError>()(
  "MemorySecretRejectedError",
  { kinds: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return "Memory rejected a value that looks like a credential. Secrets are never stored.";
  }
}

export class MemoryValidationError extends Schema.TaggedError<MemoryValidationError>()(
  "MemoryValidationError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export class MemoryNotFoundError extends Schema.TaggedError<MemoryNotFoundError>()(
  "MemoryNotFoundError",
  { id: Schema.String },
) {
  override get message(): string {
    return `Unknown memory entry '${this.id}'.`;
  }
}

export interface MemoryAddInput {
  readonly scope: "global" | "project";
  readonly projectId: string | null;
  readonly kind: MemoryEntry["kind"];
  readonly text: string;
  readonly tags: ReadonlyArray<string>;
  readonly confidence: number;
  readonly source: MemoryEntry["source"];
}

export interface MemoryAddResult {
  readonly entry: MemoryEntry;
  readonly created: boolean;
}

export class MemoryStore extends Context.Service<
  MemoryStore,
  {
    readonly read: Effect.Effect<ReadonlyArray<MemoryEntry>>;
    readonly readLastExtractionAt: Effect.Effect<string | null>;
    readonly add: (
      input: MemoryAddInput & { readonly maxEntries: number },
    ) => Effect.Effect<
      MemoryAddResult,
      MemoryStoreError | MemorySecretRejectedError | MemoryValidationError
    >;
    readonly update: (
      id: string,
      patch: { readonly text?: string; readonly tags?: ReadonlyArray<string> },
    ) => Effect.Effect<
      MemoryEntry,
      MemoryStoreError | MemoryNotFoundError | MemorySecretRejectedError | MemoryValidationError
    >;
    readonly remove: (id: string) => Effect.Effect<void, MemoryStoreError>;
    /** Bumps the recall counter for the entries a turn actually injected. */
    readonly recordRecalls: (ids: ReadonlyArray<string>) => Effect.Effect<void, MemoryStoreError>;
    readonly stats: Effect.Effect<MemoryStats>;
    readonly setLastExtractionAt: (at: string) => Effect.Effect<void, MemoryStoreError>;
    readonly replaceAll: (
      entries: ReadonlyArray<MemoryEntry>,
    ) => Effect.Effect<void, MemoryStoreError>;
  }
>()("t3/codeitlab/memory/MemoryStore") {}

const clampConfidence = (value: number): number => Math.min(1, Math.max(0, value));

/** Highest-value entries survive pruning; recency only breaks near-ties. */
export const pruneMemories = (
  entries: ReadonlyArray<MemoryEntry>,
  maxEntries: number,
  nowMs: number,
): ReadonlyArray<MemoryEntry> => {
  if (entries.length <= maxEntries) return entries;
  const scored = entries.map((entry) => {
    const ageDays = Math.max(0, (nowMs - Date.parse(entry.updatedAt)) / 86_400_000);
    const recency = 0.5 ** (ageDays / 30);
    const value =
      0.5 * clampConfidence(entry.confidence) +
      0.3 * Math.min(1, entry.recalls / 10) +
      0.2 * recency;
    return { entry, value };
  });
  scored.sort((left, right) => {
    if (right.value !== left.value) return right.value - left.value;
    return Date.parse(right.entry.updatedAt) - Date.parse(left.entry.updatedAt);
  });
  return scored.slice(0, Math.max(0, maxEntries)).map(({ entry }) => entry);
};

const computeStats = (
  entries: ReadonlyArray<MemoryEntry>,
  lastExtractionAt: string | null,
): MemoryStats => {
  const byKind: Record<string, number> = {};
  for (const entry of entries) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  return {
    total: entries.length,
    global: entries.filter((entry) => entry.scope === "global").length,
    project: entries.filter((entry) => entry.scope === "project").length,
    byKind,
    lastExtractionAt,
  };
};

export const make = Effect.fn("codeitlab.memory.store.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* Crypto.Crypto;

  const directory = path.join(config.stateDir, "codeitlab", "memory");
  const entriesPath = path.join(directory, "memory.jsonl");
  const metaPath = path.join(directory, "meta.json");

  const entriesRef = yield* Ref.make<ReadonlyArray<MemoryEntry>>([]);
  const metaRef = yield* Ref.make<MemoryMeta>({ lastExtractionAt: null });
  const writeLock = yield* Semaphore.make(1);

  // `writeFileStringAtomically` asks for FileSystem/Path from its caller's
  // context; this service already holds both, so provide them once here.
  const atomicWrite = (filePath: string, contents: string): Effect.Effect<void, MemoryStoreError> =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) => new MemoryStoreError({ operation: "persist", path: filePath, cause }),
      ),
    );

  const persistMeta = (meta: MemoryMeta) => atomicWrite(metaPath, `${encodeMeta(meta)}\n`);

  const persistEntries = (entries: ReadonlyArray<MemoryEntry>) =>
    atomicWrite(
      entriesPath,
      entries.length === 0 ? "" : `${entries.map((entry) => encodeLine(entry)).join("\n")}\n`,
    );

  const load = Effect.gen(function* () {
    const entriesText = yield* fs.readFileString(entriesPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
    );
    const entries: MemoryEntry[] = [];
    const seen = new Set<string>();
    for (const line of entriesText.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const decoded = decodeLine(trimmed);
      if (Option.isNone(decoded)) continue;
      // Later lines win: the store rewrites the file, but a hand-edited file
      // must not resurrect a duplicate id.
      if (seen.has(decoded.value.id)) {
        const index = entries.findIndex((entry) => entry.id === decoded.value.id);
        if (index >= 0) entries[index] = decoded.value;
        continue;
      }
      seen.add(decoded.value.id);
      entries.push(decoded.value);
    }
    const metaText = yield* fs.readFileString(metaPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
    );
    const meta = Option.getOrElse(decodeMeta(metaText.trim()), () => ({
      lastExtractionAt: null,
    }));
    return { entries, meta } satisfies { entries: ReadonlyArray<MemoryEntry>; meta: MemoryMeta };
  }).pipe(
    Effect.catchDefect((cause) =>
      Effect.logWarning("Failed to load the memory store; starting empty.", { cause }).pipe(
        Effect.as({ entries: [] as ReadonlyArray<MemoryEntry>, meta: { lastExtractionAt: null } }),
      ),
    ),
  );

  const loaded = yield* load;
  yield* Ref.set(entriesRef, loaded.entries);
  yield* Ref.set(metaRef, loaded.meta);

  const read = Ref.get(entriesRef);

  const newEntryId = crypto
    .randomUUIDv7()
    .pipe(
      Effect.mapError(
        (cause) => new MemoryStoreError({ operation: "add", path: entriesPath, cause }),
      ),
    );

  const add = Effect.fn("codeitlab.memory.store.add")(function* (
    input: MemoryAddInput & { readonly maxEntries: number },
  ) {
    const text = normalizeMemoryText(input.text);
    if (text.length === 0) {
      return yield* Effect.fail(
        new MemoryValidationError({ reason: "Memory text cannot be empty." }),
      );
    }
    if (text.length > MAX_MEMORY_TEXT_LENGTH) {
      return yield* Effect.fail(
        new MemoryValidationError({
          reason: `Memory text is longer than ${MAX_MEMORY_TEXT_LENGTH} characters.`,
        }),
      );
    }
    const nowIso = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    return yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* Ref.get(entriesRef);
        const existing = entries.find(
          (entry) =>
            entry.scope === input.scope &&
            entry.projectId === (input.projectId ?? null) &&
            isNearDuplicateMemory(entry.text, text),
        );
        if (existing !== undefined) {
          const updated: MemoryEntry = {
            ...existing,
            tags: [...new Set([...existing.tags, ...input.tags])].slice(0, 10),
            confidence: Math.max(existing.confidence, clampConfidence(input.confidence)),
            updatedAt: nowIso,
          };
          const next = entries.map((entry) => (entry.id === existing.id ? updated : entry));
          yield* Ref.set(entriesRef, next);
          yield* persistEntries(next);
          return { entry: updated, created: false };
        }

        const id = `mem_${yield* newEntryId}`;
        const entry: MemoryEntry = {
          id,
          scope: input.scope,
          projectId: input.projectId,
          kind: input.kind,
          text,
          source: input.source,
          createdAt: nowIso,
          updatedAt: nowIso,
          recalls: 0,
          tags: [...new Set(input.tags)].slice(0, 10),
          confidence: clampConfidence(input.confidence),
        };
        const next = pruneMemories(
          [...entries, entry],
          input.maxEntries,
          yield* Clock.currentTimeMillis,
        );
        yield* Ref.set(entriesRef, next);
        yield* persistEntries(next);
        return { entry, created: true };
      }),
    );
  });

  const update = Effect.fn("codeitlab.memory.store.update")(function* (
    id: string,
    patch: { readonly text?: string; readonly tags?: ReadonlyArray<string> },
  ) {
    const nowIso = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    return yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* Ref.get(entriesRef);
        const current = entries.find((entry) => entry.id === id);
        if (current === undefined) {
          return yield* Effect.fail(new MemoryNotFoundError({ id }));
        }
        const text = patch.text === undefined ? current.text : normalizeMemoryText(patch.text);
        if (patch.text !== undefined && text.length === 0) {
          return yield* Effect.fail(
            new MemoryValidationError({ reason: "Memory text cannot be empty." }),
          );
        }
        const updated: MemoryEntry = {
          ...current,
          ...(patch.text === undefined ? {} : { text }),
          ...(patch.tags === undefined ? {} : { tags: [...new Set(patch.tags)].slice(0, 10) }),
          updatedAt: nowIso,
        };
        const next = entries.map((entry) => (entry.id === id ? updated : entry));
        yield* Ref.set(entriesRef, next);
        yield* persistEntries(next);
        return updated;
      }),
    );
  });

  const remove = Effect.fn("codeitlab.memory.store.remove")(function* (id: string) {
    yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* Ref.get(entriesRef);
        const next = entries.filter((entry) => entry.id !== id);
        if (next.length === entries.length) return;
        yield* Ref.set(entriesRef, next);
        yield* persistEntries(next);
      }),
    );
  });

  const recordRecalls = Effect.fn("codeitlab.memory.store.recordRecalls")(function* (
    ids: ReadonlyArray<string>,
  ) {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* Ref.get(entriesRef);
        const next = entries.map((entry) =>
          wanted.has(entry.id) ? { ...entry, recalls: entry.recalls + 1 } : entry,
        );
        yield* Ref.set(entriesRef, next);
        yield* persistEntries(next);
      }),
    );
  });

  const stats = Effect.gen(function* () {
    const entries = yield* Ref.get(entriesRef);
    const meta = yield* Ref.get(metaRef);
    return computeStats(entries, meta.lastExtractionAt);
  });

  const setLastExtractionAt = Effect.fn("codeitlab.memory.store.setLastExtractionAt")(function* (
    at: string,
  ) {
    yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const meta = { lastExtractionAt: at } satisfies MemoryMeta;
        yield* Ref.set(metaRef, meta);
        yield* persistMeta(meta);
      }),
    );
  });

  const replaceAll = Effect.fn("codeitlab.memory.store.replaceAll")(function* (
    entries: ReadonlyArray<MemoryEntry>,
  ) {
    yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        const deduped = [...new Map(entries.map((entry) => [entry.id, entry])).values()];
        yield* Ref.set(entriesRef, deduped);
        yield* persistEntries(deduped);
      }),
    );
  });

  return MemoryStore.of({
    read,
    readLastExtractionAt: Ref.get(metaRef).pipe(Effect.map((meta) => meta.lastExtractionAt)),
    add,
    update,
    remove,
    recordRecalls,
    stats,
    setLastExtractionAt,
    replaceAll,
  });
});

export const layer = Layer.effect(MemoryStore, make());

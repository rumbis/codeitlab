import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Persistent memory, modelled on the DeepSeek Harness memory layer. */

export const MemoryScope = Schema.Literals(["global", "project"]);
export type MemoryScope = typeof MemoryScope.Type;

export const MemoryKind = Schema.Literals([
  "fact",
  "preference",
  "decision",
  "convention",
  "gotcha",
  "session-summary",
]);
export type MemoryKind = typeof MemoryKind.Type;

export const MemoryEntry = Schema.Struct({
  id: Schema.String,
  scope: MemoryScope,
  /** Project id for project-scoped memories; null for global. */
  projectId: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  kind: MemoryKind,
  text: Schema.String,
  /** Where it came from, for trust and debugging. */
  source: Schema.Literals(["turn", "manual", "import", "nexus"]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  /** Number of times this memory has been recalled into a turn. */
  recalls: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  /** Optional structured payload (paths, commands) extracted with the fact. */
  tags: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** 0..1 confidence; extraction may produce weaker candidates. */
  confidence: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0.5))),
});
export type MemoryEntry = typeof MemoryEntry.Type;

export const MemorySearchHit = Schema.Struct({
  entry: MemoryEntry,
  score: Schema.Number,
});
export type MemorySearchHit = typeof MemorySearchHit.Type;

export const MemorySearchInput = Schema.Struct({
  query: Schema.String,
  projectId: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  limit: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(8))),
  minScore: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0.2))),
});
export type MemorySearchInput = typeof MemorySearchInput.Type;

export const MemoryStats = Schema.Struct({
  total: Schema.Number,
  global: Schema.Number,
  project: Schema.Number,
  byKind: Schema.Record(Schema.String, Schema.Number).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  lastExtractionAt: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type MemoryStats = typeof MemoryStats.Type;

export const MemoryRecall = Schema.Struct({
  query: Schema.String,
  hits: Schema.Array(MemorySearchHit).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Rendered block injected into turn instructions. */
  injectedText: Schema.String,
});
export type MemoryRecall = typeof MemoryRecall.Type;

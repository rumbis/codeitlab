import { MemoryEntry } from "@codeitlab/core/memory";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isNearDuplicateMemory } from "./extraction.ts";

/**
 * Export/import is a plain JSON document so a user can inspect, diff, or move
 * memory between environments without a database migration.
 */

export const MemoryExportDocument = Schema.Struct({
  version: Schema.Literal(1),
  exportedAt: Schema.String,
  entries: Schema.Array(MemoryEntry),
});
export type MemoryExportDocument = typeof MemoryExportDocument.Type;

export class MemoryExportDecodeError extends Schema.TaggedError<MemoryExportDecodeError>()(
  "MemoryExportDecodeError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const encodeExport = Schema.encodeSync(Schema.fromJsonString(MemoryExportDocument));
const decodeExport = Schema.decodeUnknownOption(Schema.fromJsonString(MemoryExportDocument));

export const serializeMemoryExport = (
  entries: ReadonlyArray<MemoryEntry>,
  exportedAt: string,
): string => `${encodeExport({ version: 1, exportedAt, entries: [...entries] })}\n`;

export const parseMemoryExport = (json: string): Option.Option<ReadonlyArray<MemoryEntry>> =>
  Option.map(decodeExport(json), (document) => document.entries);

/** Effectful wrapper used by the service so callers get a typed decode failure. */
export const decodeMemoryExport = (
  json: string,
): Effect.Effect<ReadonlyArray<MemoryEntry>, MemoryExportDecodeError> =>
  Option.match(parseMemoryExport(json), {
    onNone: () =>
      Effect.fail(
        new MemoryExportDecodeError({
          reason: "The memory export document is not valid JSON for this schema version.",
        }),
      ),
    onSome: (entries) => Effect.succeed(entries),
  });

/**
 * Import is additive and never resurrects a deleted entry by accident: an id
 * already present is skipped, and a near-duplicate of an existing memory is
 * dropped in favour of the copy the user is importing only when its content is
 * newer.
 */
export const mergeImportedMemories = (
  existing: ReadonlyArray<MemoryEntry>,
  imported: ReadonlyArray<MemoryEntry>,
): ReadonlyArray<MemoryEntry> => {
  const merged = [...existing];
  const ids = new Set(existing.map((entry) => entry.id));
  for (const candidate of imported) {
    if (ids.has(candidate.id)) continue;
    const duplicate = merged.find(
      (entry) =>
        entry.scope === candidate.scope &&
        entry.projectId === candidate.projectId &&
        isNearDuplicateMemory(entry.text, candidate.text),
    );
    if (duplicate !== undefined) {
      if (Date.parse(candidate.updatedAt) > Date.parse(duplicate.updatedAt)) {
        merged[merged.indexOf(duplicate)] = candidate;
        ids.add(candidate.id);
      }
      continue;
    }
    merged.push(candidate);
    ids.add(candidate.id);
  }
  return merged;
};

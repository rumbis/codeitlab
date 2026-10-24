import type { MemoryEntry } from "@codeitlab/core/memory";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  decodeMemoryExport,
  MemoryExportDecodeError,
  mergeImportedMemories,
  serializeMemoryExport,
} from "./export.ts";
import { MemoryStore, MemoryStoreError } from "./MemoryStore.ts";

/**
 * Whole-corpus export/import. Kept off the RPC tag because it is a bulk admin
 * operation (the web panel exports from Settings); agents reach the same data
 * through the search/add methods.
 */
export class MemoryTransferService extends Context.Service<
  MemoryTransferService,
  {
    readonly exportJson: Effect.Effect<string>;
    readonly importJson: (
      json: string,
    ) => Effect.Effect<
      { readonly imported: number; readonly total: number },
      MemoryExportDecodeError | MemoryStoreError
    >;
  }
>()("codeitlab/codeitlab/memory/MemoryTransfer/MemoryTransferService") {}

export const make = Effect.fn("codeitlab.memory.transfer.make")(function* () {
  const store = yield* MemoryStore;

  const exportJson = Effect.gen(function* () {
    const entries = yield* store.read;
    const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    return serializeMemoryExport(entries, at);
  });

  const importJson = Effect.fn("codeitlab.memory.import")(function* (json: string) {
    const imported = yield* decodeMemoryExport(json);
    const existing = yield* store.read;
    const merged = mergeImportedMemories(existing, imported);
    yield* store.replaceAll(merged);
    return { imported: Math.max(0, merged.length - existing.length), total: merged.length };
  });

  return MemoryTransferService.of({ exportJson, importJson });
});

export const layer = Layer.effect(MemoryTransferService, make());

export type { MemoryEntry };

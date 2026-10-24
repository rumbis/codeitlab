import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

/**
 * Per-thread opt-out for the CodeitLab policy packs.
 *
 * The user stops the terseness/minimal-change packs by saying "stop caveman",
 * "normal mode", or "stop terse", and turns them back on with "caveman mode" or
 * "ponytail mode". The override is per thread and survives a restart, so a
 * thread does not silently re-acquire the packs after the next message.
 *
 * A malformed file is treated as empty: losing an opt-out is annoying, but a
 * broken JSON file must never block a turn.
 */

export type ThreadPackOverride = "off" | "on";

const OVERRIDES_FILE = "threadOverrides.json";

const ThreadPackOverrides = Schema.Record(Schema.String, Schema.Literals(["off", "on"]));
const decodeOverrides = Schema.decodeUnknownOption(Schema.fromJsonString(ThreadPackOverrides));
const encodeOverrides = Schema.encodeSync(Schema.fromJsonString(ThreadPackOverrides));

const STOP_PHRASES = ["stop caveman", "normal mode", "stop terse", "stop ponytail"] as const;
const START_PHRASES = ["caveman mode", "terse mode", "ponytail mode", "enable caveman"] as const;

/** Normalizes a message so "Stop caveman." and "stop caveman!" match. */
const normalizePrompt = (prompt: string): string =>
  prompt
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/u, "")
    .replace(/\s+/gu, " ");

/** Returns the override a user message asks for, if any. */
export const readPackOverrideCommand = (prompt: string): ThreadPackOverride | undefined => {
  const normalized = normalizePrompt(prompt);
  // Only short control messages count; a long message that merely contains the
  // phrase is a normal turn.
  if (normalized.length > 48) return undefined;
  if (STOP_PHRASES.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `))) {
    return "off";
  }
  if (
    START_PHRASES.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `))
  ) {
    return "on";
  }
  return undefined;
};

export const overridesPath = (stateDir: string, join: (...parts: string[]) => string): string =>
  join(stateDir, "codeitlab", "ecosystem", OVERRIDES_FILE);

export interface ThreadOverrideStore {
  readonly get: (
    threadId: string,
  ) => Effect.Effect<ThreadPackOverride | undefined, PlatformError.PlatformError>;
  readonly set: (
    threadId: string,
    value: ThreadPackOverride | undefined,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
}

export const makeThreadOverrideStore = Effect.fn("codeitlab.ecosystem.threadOverrides.make")(
  function* (options: { readonly stateDir: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = overridesPath(options.stateDir, (...parts) => path.join(...parts));
    const directory = path.dirname(filePath);

    const readAll = (): Effect.Effect<
      Readonly<Record<string, ThreadPackOverride>>,
      PlatformError.PlatformError
    > =>
      fs.readFileString(filePath).pipe(
        Effect.map((raw) =>
          Option.match(decodeOverrides(raw), {
            onNone: () => ({}) as Readonly<Record<string, ThreadPackOverride>>,
            onSome: (decoded) => decoded as Readonly<Record<string, ThreadPackOverride>>,
          }),
        ),
        // A missing file is the normal first-run state.
        Effect.catch(() => Effect.succeed({} as Readonly<Record<string, ThreadPackOverride>>)),
      );

    const writeAll = Effect.fn("codeitlab.ecosystem.writeThreadOverrides")(function* (
      overrides: Readonly<Record<string, ThreadPackOverride>>,
    ) {
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* writeFileStringAtomically({
        filePath,
        contents: `${encodeOverrides(overrides)}\n`,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
    });

    return {
      get: (threadId) =>
        readAll().pipe(
          Effect.map((overrides) => overrides[threadId] as ThreadPackOverride | undefined),
        ),
      set: (threadId, value) =>
        readAll().pipe(
          Effect.flatMap((overrides) => {
            const next: Record<string, ThreadPackOverride> = { ...overrides };
            if (value === undefined) {
              delete next[threadId];
            } else {
              next[threadId] = value;
            }
            return writeAll(next);
          }),
        ),
    } satisfies ThreadOverrideStore;
  },
);

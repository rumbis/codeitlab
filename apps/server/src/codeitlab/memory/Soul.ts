import { MemoryEntry } from "@codeitlab/core/memory";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import { writeFileStringAtomically } from "@codeitlab/shared/atomicWrite";

import * as ServerConfig from "../../config.ts";
import * as MemoryStore from "./MemoryStore.ts";

/**
 * The soul is the human-readable half of the agent's memory: two Markdown files
 * a person can open, read and edit. The JSONL corpus holds ids, scores and
 * recall counts, which is not something a user wants to read; these files are
 * rendered from that corpus so the two halves can never disagree.
 *
 * Entries are separated by a lone separator line rather than by blank lines or
 * list markers, because one entry may legitimately span several lines and any
 * weaker separator would make the file ambiguous to parse back.
 */

const ENTRY_SEPARATOR = "§";
const SOUL_FILE = "SOUL.md";
const USER_FILE = "USER.md";

const HEADER_NOTE = "entries are separated by the " + ENTRY_SEPARATOR + " marker";

const MEMORY_HEADER = [
  "# What I have learned",
  "",
  "Written by the agent itself while working; " + HEADER_NOTE + ".",
  "Edit freely: the next turn reads this file.",
].join("\n");

const USER_HEADER = [
  "# Who I am working with",
  "",
  "What the agent has observed about the person it works with; " + HEADER_NOTE + ".",
].join("\n");

export interface SoulDocument {
  /** Free-form text the user wrote by hand; preserved verbatim across refreshes. */
  readonly preamble: string;
  readonly entries: ReadonlyArray<string>;
}

export interface SoulFiles {
  readonly memory: string;
  readonly user: string;
}

export interface SoulSnapshot extends SoulFiles {
  readonly renderedAt: string;
}

/**
 * Kinds that describe the *person* rather than the *work*. A preference is the
 * user's taste, so it belongs in USER.md; a convention or gotcha describes the
 * project and stays in the learned half.
 */
const USER_KINDS: ReadonlySet<MemoryEntry["kind"]> = new Set(["preference"]);

export const splitSoulEntries = (body: string): ReadonlyArray<string> =>
  body
    .split(ENTRY_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const joinSoulEntries = (entries: ReadonlyArray<string>): string =>
  entries
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join("\n\n" + ENTRY_SEPARATOR + "\n\n");

/**
 * Drops the generated header, whichever soul file this text came from. Matching
 * the known headers keeps a user paragraph that happens to start with "#" intact.
 */
const stripRenderedHeader = (text: string): string => {
  for (const header of [MEMORY_HEADER, USER_HEADER]) {
    if (text.startsWith(header)) return text.slice(header.length);
  }
  // A file written by an older version may carry only the H1 line.
  return text.replace(/^#[^\n]*\n\n?/, "");
};

/**
 * Parses a soul file back into its parts. Everything before the first separator
 * is the preamble, so a user who adds a paragraph of their own at the top keeps
 * it on the next refresh.
 */
export const parseSoulDocument = (text: string): SoulDocument => {
  // Strip the header we wrote by matching it, not by guessing at its shape. The
  // headers span several lines, so a regex for "the first line" would leave the
  // header prose behind, capture it as the user preamble, and write it back
  // again on top of the real header -- growing on every refresh.
  const withoutHeader = stripRenderedHeader(text);
  // A rendered file marks the boundary with an empty § segment first, so the
  // preamble is exactly what sits above it. Falling back to the first marker is
  // what older files and hand-written notes rely on.
  const separatorIndex = withoutHeader.indexOf("\n" + ENTRY_SEPARATOR);
  if (separatorIndex < 0) {
    const body = withoutHeader.trim();
    // No separator means nothing has been learned into this file yet, so whatever
    // is here was typed by hand. Treating it as an entry would let the next
    // refresh re-render the user's prose as a generated bullet and drop it out of
    // the preamble, where they can no longer tell their words from ours.
    const looksRendered = /^- /m.test(body) && !/\n\s*\n/.test(body.trim());
    return looksRendered
      ? { preamble: "", entries: splitSoulEntries(body) }
      : { preamble: body, entries: [] };
  }
  // Everything above the first marker is the preamble by contract. Guessing which
  // lines "look like" entries would silently discard text a user typed by hand,
  // and keeping their words matters more than absorbing an unmarked entry.
  const preamble = withoutHeader.slice(0, separatorIndex).trim();
  const parsed = splitSoulEntries(withoutHeader.slice(separatorIndex));
  // Text after the last marker is a note the user appended below the learned
  // half, which is where people naturally add one. Re-rendering replaces that
  // region from the corpus, so anything not recognised as an entry would be
  // destroyed. Move it into the preamble and take it back out of the entry, so it
  // survives the refresh instead of being written twice.
  const trailing = trailingNote(parsed);
  const entries = trailing.length > 0 ? [...parsed.slice(0, -1), lastEntryHead(parsed)] : parsed;
  return {
    preamble: [preamble, trailing].filter((part) => part.length > 0).join("\n\n"),
    entries: entries.filter((entry) => entry.length > 0),
  };
};

export const renderSoulDocument = (header: string, document: SoulDocument): string => {
  const parts = [header.trimEnd()];
  if (document.preamble.length > 0) parts.push(document.preamble);
  if (document.entries.length === 0) return parts.join("\n\n") + "\n";
  // An empty segment before the first marker separates the preamble from the
  // learned half explicitly. Without it the boundary is inferred from "the first
  // §", so a preamble line that looks like an entry re-parses as one and gets
  // re-rendered into the preamble again on every refresh.
  const learned = joinSoulEntries(document.entries);
  // Written even when the preamble is empty: the leading marker is what lets the
  // parser put the whole boundary above it instead of guessing.
  return parts.join("\n\n") + "\n\n" + ENTRY_SEPARATOR + "\n\n" + learned + "\n";
};

/**
 * Recovers a note appended after the last separator. An entry is a single line
 * beginning with "- " (see describeEntry); a run below the last marker that does
 * not look like one is the user talking to us, so it must not be re-rendered away.
 */
const trailingNote = (entries: ReadonlyArray<string>): string => {
  const last = entries.at(-1);
  if (last === undefined) return "";
  const lines = last.split("\n");
  // A generated entry is one line; anything after it was appended by hand.
  const [first, ...rest] = lines;
  const body = rest.join("\n").trim();
  if (body.length === 0) return "";
  // Leave a hand-written multi-line entry alone, so an entry that is legitimately
  // prose is not split off into the preamble.
  if (!isRenderedEntry(first!)) return "";
  return body;
};

const isRenderedEntry = (line: string): boolean => /^- \S/.test(line.trim());

const lastEntryHead = (entries: ReadonlyArray<string>): string =>
  entries.at(-1)!.split("\n")[0]!.trim();

const describeEntry = (entry: MemoryEntry): string => {
  const tags = entry.tags.length > 0 ? " [" + entry.tags.join(", ") + "]" : "";
  return "- " + entry.text + tags;
};

/**
 * Ordered by how often an entry has actually been recalled: a memory that keeps
 * changing turns is the closest thing the corpus has to "what matters to me",
 * and recall count beats recency as a tie-break on purpose.
 */
const sortForSoul = (entries: ReadonlyArray<MemoryEntry>): ReadonlyArray<MemoryEntry> =>
  [...entries].sort((a, b) => {
    if (b.recalls !== a.recalls) return b.recalls - a.recalls;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });

export const buildSoulSnapshot = (
  entries: ReadonlyArray<MemoryEntry>,
  renderedAt: string,
): SoulSnapshot => {
  const usable = entries.filter((entry) => entry.text.trim().length > 0);
  const userEntries = sortForSoul(usable.filter((entry) => USER_KINDS.has(entry.kind)));
  const learnedEntries = sortForSoul(usable.filter((entry) => !USER_KINDS.has(entry.kind)));
  return {
    memory: renderSoulDocument(MEMORY_HEADER, {
      preamble: "",
      entries: learnedEntries.map(describeEntry),
    }),
    user: renderSoulDocument(USER_HEADER, {
      preamble: "",
      entries: userEntries.map(describeEntry),
    }),
    renderedAt,
  };
};

export class Soul extends Context.Service<
  Soul,
  {
    /** Current contents; rendered on demand when the files were never written. */
    readonly read: Effect.Effect<SoulFiles>;
    /** Rewrites both files from the corpus, preserving any hand-written preamble. */
    readonly refresh: Effect.Effect<SoulFiles>;
  }
>()("codeitlab/codeitlab/memory/Soul") {}

export const make = Effect.fn("codeitlab.memory.soul.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const store = yield* MemoryStore.MemoryStore;

  const directory = path.join(config.stateDir, "codeitlab", "memory");
  const memoryPath = path.join(directory, SOUL_FILE);
  const userPath = path.join(directory, USER_FILE);

  // Refresh runs from several turns at once; the write must stay whole.
  const lock = yield* Semaphore.make(1);

  const write = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const readExisting = (filePath: string) =>
    fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));

  const render = Effect.gen(function* () {
    const entries = yield* store.read;
    const now = yield* Clock.currentTimeMillis;
    return buildSoulSnapshot(entries, DateTime.formatIso(DateTime.makeUnsafe(now)));
  });

  const keepsPreamble = (previous: string, header: string, rendered: string): string => {
    if (previous.trim().length === 0) return rendered;
    const preamble = parseSoulDocument(previous).preamble;
    if (preamble.length === 0) return rendered;
    const fresh = parseSoulDocument(rendered);
    return renderSoulDocument(header, { preamble, entries: fresh.entries });
  };

  const refreshLocked = Effect.gen(function* () {
    const snapshot = yield* render;
    const previousMemory = yield* readExisting(memoryPath);
    const previousUser = yield* readExisting(userPath);
    const next: SoulFiles = {
      memory: keepsPreamble(previousMemory, MEMORY_HEADER, snapshot.memory),
      user: keepsPreamble(previousUser, USER_HEADER, snapshot.user),
    };
    yield* write(memoryPath, next.memory);
    yield* write(userPath, next.user);
    return next;
  });

  return {
    read: Effect.gen(function* () {
      const memory = yield* readExisting(memoryPath);
      const user = yield* readExisting(userPath);
      if (memory.length > 0 || user.length > 0) return { memory, user };
      const snapshot = yield* render;
      return { memory: snapshot.memory, user: snapshot.user };
    }).pipe(Effect.catchCause(() => Effect.succeed({ memory: "", user: "" }))),
    refresh: lock
      .withPermits(1)(refreshLocked)
      .pipe(
        // A soul file that cannot be written must never fail the turn that wrote it.
        Effect.catchCause((cause) =>
          Effect.logWarning("Soul refresh failed; the stored memory is intact.", { cause }).pipe(
            Effect.as({ memory: "", user: "" }),
          ),
        ),
      ),
  };
});

export const layer = Layer.effect(Soul, make());

/** File names, for the settings page hint and for tests. */
export const soulFileNames = { memory: SOUL_FILE, user: USER_FILE } as const;

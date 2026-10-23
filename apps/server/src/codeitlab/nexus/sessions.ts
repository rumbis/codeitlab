// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- bounded head reads and zstd decompression are synchronous by design; streaming a 12 MB JSONL history per refresh would be worse.
import * as NodeFS from "node:fs";
import * as NodeZlib from "node:zlib";

import type { NexusSession } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import type { NexusSourceResult } from "./skills.ts";

const MAX_HEAD_BYTES = 256 * 1024;
const MAX_SESSION_FILES = 120;
const MAX_SESSIONS_PER_HARNESS = 40;
const MAX_ZSTD_BYTES = 4 * 1024 * 1024;
const MAX_TITLE_CHARS = 120;

const readHead = (filePath: string): string | undefined => {
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(filePath, "r");
    const buffer = Buffer.alloc(MAX_HEAD_BYTES);
    const read = NodeFS.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        NodeFS.closeSync(fd);
      } catch {
        // Closing a read-only handle cannot fail in a way that matters here.
      }
    }
  }
};

const parseJsonLines = (contents: string): ReadonlyArray<Record<string, unknown>> => {
  const records: Array<Record<string, unknown>> = [];
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object") {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      // A bounded head can cut the final record in half; ignore it.
    }
  }
  return records;
};

const boundedTitle = (value: string | undefined): string => {
  const singleLine = value?.replace(/\s+/gu, " ").trim() ?? "";
  return singleLine.length === 0 ? "" : singleLine.slice(0, MAX_TITLE_CHARS);
};

const isHarnessNoise = (text: string): boolean =>
  text.startsWith("<") ||
  text.startsWith("Current runtime context") ||
  text.startsWith("Time sampled while preparing") ||
  text.startsWith("The approval policy changed") ||
  text.startsWith("A skill is a reusable");

const textFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (part !== null && typeof part === "object") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return [text];
      }
      return [];
    })
    .join(" ");
};

const isoFromStat = (filePath: string): string | undefined => {
  try {
    return NodeFS.statSync(filePath).mtime.toISOString();
  } catch {
    return undefined;
  }
};

interface SessionFile {
  readonly filePath: string;
  readonly id: string;
  readonly updatedAt: string;
}

const listFiles = (
  directory: string,
  options: { readonly recursive: boolean; readonly filter: (name: string) => boolean },
): ReadonlyArray<SessionFile> => {
  const found: Array<{ filePath: string; mtimeMs: number }> = [];
  const walk = (current: string, depth: number): void => {
    if (found.length >= MAX_SESSION_FILES * 2 || depth > 3) return;
    let entries: ReadonlyArray<import("node:fs").Dirent>;
    try {
      entries = NodeFS.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        if (options.recursive) walk(child, depth + 1);
      } else if (entry.isFile() && options.filter(entry.name)) {
        try {
          found.push({ filePath: child, mtimeMs: NodeFS.statSync(child).mtimeMs });
        } catch {
          // Raced with a harness cleanup; skip it.
        }
      }
    }
  };
  walk(directory, 0);
  return found
    .toSorted((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_SESSION_FILES)
    .flatMap(({ filePath, mtimeMs }) => {
      const name = filePath.split("/").pop() ?? "";
      const id = name.replace(/\.jsonl(\.zstd)?$/u, "");
      return [{ filePath, id, updatedAt: new Date(mtimeMs).toISOString() }];
    });
};

const readHermesSessions = (homeDir: string): ReadonlyArray<NexusSession> => {
  const files = listFiles(`${homeDir}/.hermes/sessions`, {
    recursive: false,
    filter: (name) => name.endsWith(".jsonl") && !name.startsWith("request_dump_"),
  });
  return files.slice(0, MAX_SESSIONS_PER_HARNESS).flatMap((file) => {
    const contents = readHead(file.filePath);
    if (contents === undefined) return [];
    const records = parseJsonLines(contents);
    const userRecord = records.find((record) => record.role === "user");
    const summary = records.find((record) => typeof record._compressed_summary === "string");
    const title =
      boundedTitle(textFromContent(userRecord?.content)) ||
      boundedTitle(summary?._compressed_summary as string | undefined) ||
      `Hermes session ${file.id}`;
    return [
      {
        id: file.id,
        providerInstanceId: "hermes",
        providerKind: "hermes",
        title,
        updatedAt: file.updatedAt,
        messageCount: records.length,
        remote: false,
      } satisfies NexusSession,
    ];
  });
};

const readClaudeSessions = (homeDir: string): ReadonlyArray<NexusSession> => {
  const projectsDir = `${homeDir}/.claude/projects`;
  const files = listFiles(projectsDir, {
    recursive: true,
    filter: (name) => name.endsWith(".jsonl"),
  });
  return files.slice(0, MAX_SESSIONS_PER_HARNESS).flatMap((file) => {
    const contents = readHead(file.filePath);
    if (contents === undefined) return [];
    const records = parseJsonLines(contents);
    const userRecord = records.find(
      (record) =>
        record.type === "user" &&
        record.message !== null &&
        typeof record.message === "object" &&
        (record.message as { role?: unknown }).role === "user",
    );
    const message = userRecord?.message as { content?: unknown } | undefined;
    const cwdRecord = records.find((record) => typeof record.cwd === "string");
    const title =
      boundedTitle(textFromContent(message?.content)) ||
      boundedTitle(
        records.find((record) => typeof record.summary === "string")?.summary as string | undefined,
      ) ||
      `Claude session ${file.id}`;
    return [
      {
        id: file.id,
        providerInstanceId: "claudeAgent",
        providerKind: "claude",
        title,
        updatedAt: file.updatedAt,
        ...(typeof cwdRecord?.cwd === "string" ? { cwd: cwdRecord.cwd } : {}),
        messageCount: records.length,
        remote: false,
      } satisfies NexusSession,
    ];
  });
};

const readDshSessions = (homeDir: string): ReadonlyArray<NexusSession> => {
  const sessionsDir = `${homeDir}/.dsh/sessions`;
  let slugs: ReadonlyArray<string>;
  try {
    slugs = NodeFS.readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const files: Array<{ filePath: string; id: string; updatedAt: string; slug: string }> = [];
  for (const slug of slugs) {
    if (slug.startsWith(".")) continue;
    const slugDir = `${sessionsDir}/${slug}`;
    let ids: ReadonlyArray<string>;
    try {
      ids = NodeFS.readdirSync(slugDir);
    } catch {
      continue;
    }
    for (const id of ids) {
      const filePath = `${slugDir}/${id}/session.v4.jsonl.zstd`;
      const updatedAt = isoFromStat(filePath);
      if (updatedAt === undefined) continue;
      files.push({ filePath, id, updatedAt, slug });
    }
  }
  return files
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_SESSIONS_PER_HARNESS)
    .flatMap((file) => {
      let contents: string;
      try {
        const size = NodeFS.statSync(file.filePath).size;
        if (size > MAX_ZSTD_BYTES) {
          contents = "";
        } else {
          contents = NodeZlib.zstdDecompressSync(NodeFS.readFileSync(file.filePath)).toString(
            "utf8",
          );
        }
      } catch {
        contents = "";
      }
      const records = parseJsonLines(contents);
      const sessionRecord = records.find((record) => record.type === "session");
      const descriptor = records.find((record) => record.type === "subagent/descriptor");
      const userRecords = records.filter((record) => record.type === "user/message");
      const label = (descriptor?.data as { label?: unknown } | undefined)?.label;
      const firstMeaningfulUserText = userRecords
        .map((record) =>
          textFromContent((record.data as { content?: unknown } | undefined)?.content),
        )
        .find((text) => text.trim().length > 0 && !isHarnessNoise(text.trim()));
      const title =
        boundedTitle(typeof label === "string" ? label : undefined) ||
        boundedTitle(firstMeaningfulUserText) ||
        `DeepSeek Harness session ${file.id}`;
      const cwd = sessionRecord?.cwd;
      return [
        {
          id: file.id,
          providerInstanceId: "dsh",
          providerKind: "dsh",
          title,
          updatedAt: file.updatedAt,
          ...(typeof cwd === "string" ? { cwd } : {}),
          messageCount: records.length,
          remote: false,
        } satisfies NexusSession,
      ];
    });
};

export const readNexusSessions = Effect.fn("Nexus.readNexusSessions")(function* (input: {
  readonly homeDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const warnings: Array<string> = [];
  const items: Array<NexusSession> = [];
  const harnesses = [
    {
      label: "Hermes",
      directory: `${input.homeDir}/.hermes/sessions`,
      read: () => readHermesSessions(input.homeDir),
    },
    {
      label: "Claude",
      directory: `${input.homeDir}/.claude/projects`,
      read: () => readClaudeSessions(input.homeDir),
    },
    {
      label: "DeepSeek Harness",
      directory: `${input.homeDir}/.dsh/sessions`,
      read: () => readDshSessions(input.homeDir),
    },
  ] as const;
  for (const harness of harnesses) {
    const result = yield* Effect.sync(harness.read).pipe(
      Effect.orElseSucceed((): Array<NexusSession> => []),
    );
    if (result.length === 0) {
      // A harness with no history is normal; only warn when its directory exists.
      const exists = yield* fs.exists(harness.directory).pipe(Effect.orElseSucceed(() => false));
      if (exists) warnings.push(`No ${harness.label} sessions could be read from local history.`);
      continue;
    }
    items.push(...result);
  }
  return {
    items: items
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_SESSION_FILES),
    warnings,
  } satisfies NexusSourceResult<NexusSession>;
});

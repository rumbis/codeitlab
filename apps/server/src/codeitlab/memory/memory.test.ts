import { assert, it } from "@effect/vitest";
import type { MemoryEntry } from "@codeitlab/core/memory";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe } from "vite-plus/test";

import {
  decodeMemoryExport,
  mergeImportedMemories,
  parseMemoryExport,
  serializeMemoryExport,
} from "./export.ts";
import {
  extractMemoryCandidates,
  isNearDuplicateMemory,
  normalizeMemoryText,
} from "./extraction.ts";
import { containsSecret, redactSecrets } from "./redaction.ts";
import { filterMemoriesForScope, rankMemoryEntries, renderMemoryRecall } from "./retrieval.ts";

const entry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: "mem_1",
  scope: "global",
  projectId: null,
  kind: "convention",
  text: "Always run focused tests with vp test run.",
  source: "manual",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  recalls: 0,
  tags: [],
  confidence: 0.8,
  ...overrides,
});

describe("secret redaction", () => {
  it("detects and redacts credential-shaped values", () => {
    const samples = [
      "token sk-abcdefghijklmnopqrstuvwxyz012345",
      "github ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "aws AKIAIOSFODNN7EXAMPLE",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "-----BEGIN RSA PRIVATE KEY-----",
    ];
    for (const sample of samples) {
      const result = redactSecrets(sample);
      assert.strictEqual(result.redacted, true, `expected redaction for ${sample}`);
      assert.strictEqual(result.text.includes("[redacted]"), true);
    }
    assert.strictEqual(containsSecret("sk-abcdefghijklmnopqrstuvwxyz012345"), true);
  });

  it("leaves ordinary prose and file paths alone", () => {
    const samples = [
      "The server listens on port 3000 and stores state in .t3/userdata.",
      "Run `vp test run apps/server/src/codeitlab/memory/memory.test.ts`.",
      "Prefer Effect.fn for reusable effect functions.",
    ];
    for (const sample of samples) {
      assert.strictEqual(redactSecrets(sample).redacted, false, `unexpected redaction: ${sample}`);
    }
  });
});

describe("memory extraction", () => {
  it("extracts explicit memory markers and durable conventions", () => {
    const candidates = extractMemoryCandidates({
      prompt: "remember: we deploy with pnpm run deploy and never touch main directly",
      assistantText: "Convention: keep services in apps/server/src and transports thin.",
    });
    assert.strictEqual(candidates.length > 0, true);
    assert.strictEqual(
      candidates.some((candidate) => candidate.text.includes("deploy with pnpm")),
      true,
    );
    assert.strictEqual(
      candidates.some((candidate) => candidate.text.includes("keep services")),
      true,
    );
  });

  it("skips questions, code fences and credential-shaped text", () => {
    const candidates = extractMemoryCandidates({
      prompt: "should we use postgres or sqlite?",
      assistantText: "Use the token sk-abcdefghijklmnopqrstuvwxyz012345 to authenticate.",
    });
    assert.strictEqual(candidates.length, 0);
  });

  it("treats near-duplicates as the same memory", () => {
    assert.strictEqual(
      isNearDuplicateMemory(
        "Always run focused tests with vp test run before committing.",
        "Always run focused tests with vp test run before you commit.",
      ),
      true,
    );
    assert.strictEqual(
      isNearDuplicateMemory("The API lives on port 3000.", "We deploy with fly.io."),
      false,
    );
    assert.strictEqual(normalizeMemoryText("  a   b  "), "a b");
  });
});

describe("memory retrieval", () => {
  const corpus = [
    entry({ id: "mem_a", text: "Memory retrieval uses BM25 scoring plus recency." }),
    entry({ id: "mem_b", text: "The router classifies coding tasks and picks a provider." }),
    entry({ id: "mem_c", text: "Nexus merges skills and MCP servers from every harness." }),
  ];

  it("ranks by relevance and explains hits", () => {
    const hits = rankMemoryEntries(corpus, "how does memory scoring work", {
      nowMs: Date.parse("2026-10-02T00:00:00.000Z"),
      limit: 3,
      minScore: 0,
    });
    assert.strictEqual(hits.length > 0, true);
    assert.strictEqual(hits[0]?.entry.id, "mem_a");
    assert.strictEqual((hits[0]?.score ?? 0) > 0, true);
  });

  it("scopes project recall to global plus the same project", () => {
    const scoped = [
      entry({ id: "g", scope: "global" }),
      entry({ id: "p1", scope: "project", projectId: "project-1" }),
      entry({ id: "p2", scope: "project", projectId: "project-2" }),
    ];
    const visible = filterMemoriesForScope(scoped, { projectId: "project-1" });
    assert.deepEqual(
      visible.map((item) => item.id),
      ["g", "p1"],
    );
  });

  it("renders an injectable block and returns nothing when empty", () => {
    const hits = rankMemoryEntries(corpus, "bm25", { nowMs: 0, limit: 1, minScore: 0 });
    const rendered = renderMemoryRecall("bm25", hits);
    assert.strictEqual(rendered.injectedText.includes("Relevant memories"), true);
    assert.strictEqual(renderMemoryRecall("bm25", []).injectedText, "");
  });
});

describe("memory export/import", () => {
  it.effect("round-trips entries through JSON and merges without duplicates", () =>
    Effect.gen(function* () {
      const entries = [
        entry({ id: "mem_a" }),
        entry({ id: "mem_b", scope: "project", projectId: "p1" }),
      ];
      const json = serializeMemoryExport(entries, "2026-10-02T00:00:00.000Z");
      assert.strictEqual(Option.getOrUndefined(parseMemoryExport(json))?.length, 2);

      const decoded = yield* decodeMemoryExport(json);
      assert.strictEqual(decoded.length, 2);

      const merged = mergeImportedMemories(
        [entries[0]!],
        [entries[0]!, entry({ id: "mem_c", text: "New fact from another machine." })],
      );
      assert.strictEqual(merged.length, 2);
    }),
  );

  it.effect("rejects a document from an unknown version", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(decodeMemoryExport('{"version":99,"entries":[]}'));
      assert.strictEqual(result._tag, "Failure");
    }),
  );
});

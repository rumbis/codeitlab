// @effect-diagnostics nodeBuiltinImport:off -- tests seed fixtures with node:fs before the Effect program runs.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import type { NexusCatalog, NexusMcpServer, NexusSession, NexusSkill } from "@codeitlab/contracts";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { buildNexusCatalog } from "./catalog.ts";
import {
  mcpFingerprint,
  mergeNexusMcpServers,
  mergeNexusSessions,
  mergeNexusSkills,
} from "./fingerprint.ts";
import { buildNexusInstructions } from "./instructions.ts";
import {
  parseClaudeMcpConfig,
  parseCodexMcpConfig,
  parseHermesMcpConfig,
  parseOpenCodeMcpConfig,
} from "./mcp.ts";
import {
  buildRemoteIngestionScript,
  parseRemoteIngestionOutput,
  toAcpMcpServer,
} from "./remote.ts";
import { readNexusSessions } from "./sessions.ts";
import { nexusSkillRoots, parseSkillDocument, readNexusSkills } from "./skills.ts";

const withTempHome = <A, E, R>(use: (home: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "nexus-test-"))),
    use,
    (home) => Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
  );

const writeFixture = (root: string, relativePath: string, contents: string): string => {
  const filePath = NodePath.join(root, relativePath);
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  NodeFS.writeFileSync(filePath, contents);
  return filePath;
};

const skill = (overrides: Partial<NexusSkill> = {}): NexusSkill => ({
  id: "hermes:review",
  name: "review",
  description: "Review code.",
  source: "hermes",
  alsoAvailableIn: [],
  ...overrides,
});

const mcp = (overrides: Partial<NexusMcpServer> = {}): NexusMcpServer => ({
  id: "pending",
  name: "exa",
  transport: "stdio",
  command: "npx",
  args: ["-y", "exa-mcp"],
  envKeys: ["EXA_API_KEY"],
  sources: ["claude"],
  enabled: true,
  tools: [],
  ...overrides,
});

const session = (overrides: Partial<NexusSession> = {}): NexusSession => ({
  id: "session-1",
  providerInstanceId: "hermes",
  providerKind: "hermes",
  title: "Fix auth bug",
  updatedAt: "2026-10-20T10:00:00.000Z",
  remote: false,
  ...overrides,
});

describe("nexus merge rules", () => {
  it("merges the same skill across harnesses and keeps every source", () => {
    const merged = mergeNexusSkills([
      skill(),
      skill({ id: "claude:review", source: "claude", description: "" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.alsoAvailableIn).toEqual(["claude"]);
    expect(merged[0]?.description).toBe("Review code.");
  });

  it("fingerprints MCP servers by command/args/env keys, never env values", () => {
    const first = mcpFingerprint(mcp());
    const same = mcpFingerprint(mcp({ envKeys: ["EXA_API_KEY"] }));
    const differentArgs = mcpFingerprint(mcp({ args: ["-y", "other-mcp"] }));
    const differentEnv = mcpFingerprint(mcp({ envKeys: ["OTHER_KEY"] }));
    expect(first).toBe(same);
    expect(first).not.toBe(differentArgs);
    expect(first).not.toBe(differentEnv);
  });

  it("merges MCP servers from several harnesses into one row", () => {
    const merged = mergeNexusMcpServers([
      mcp({ sources: ["claude"], tools: ["search"] }),
      mcp({ sources: ["hermes"], enabled: false, tools: ["crawl"] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toEqual(["claude", "hermes"]);
    expect(merged[0]?.tools).toEqual(["search", "crawl"]);
    expect(merged[0]?.enabled).toBe(true);
    expect(merged[0]?.id.startsWith("mcp-")).toBe(true);
  });

  it("keeps the newest session row and backfills thread ids", () => {
    const merged = mergeNexusSessions([
      session({ updatedAt: "2026-10-19T10:00:00.000Z" }),
      session({ updatedAt: "2026-10-21T10:00:00.000Z", threadId: "thread-9" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.updatedAt).toBe("2026-10-21T10:00:00.000Z");
    expect(merged[0]?.threadId).toBe("thread-9");
  });
});

describe("nexus source readers", () => {
  it("parses skill frontmatter and falls back to the directory name", () => {
    expect(parseSkillDocument("---\nname: my-skill\ndescription: Does things.\n---\nBody")).toEqual(
      {
        name: "my-skill",
        description: "Does things.",
      },
    );
    expect(parseSkillDocument("no frontmatter")).toEqual({});
  });

  it.effect("reads nested skill directories from a harness home", () =>
    withTempHome((home) =>
      Effect.gen(function* () {
        writeFixture(
          home,
          ".hermes/skills/ops/incident/SKILL.md",
          "---\nname: incident\n---\nRun the incident playbook.\n",
        );
        writeFixture(home, ".claude/skills/review/SKILL.md", "# Review\n\nReview diffs.\n");
        const result = yield* readNexusSkills(
          nexusSkillRoots({ homeDir: home, appSkillsDir: NodePath.join(home, "app-skills") }),
        );
        expect(result.items.map((entry) => entry.id)).toEqual(["hermes:incident", "claude:review"]);
        expect(result.items.find((entry) => entry.source === "claude")?.description).toBe(
          "Review diffs.",
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );

  it("parses Hermes, Claude, Codex and OpenCode MCP configs", () => {
    const hermes = parseHermesMcpConfig(
      [
        "mcp_servers:",
        "  stitch:",
        "    url: https://stitch.example/mcp",
        "    enabled: false",
        "  files:",
        "    command: npx",
        "    args: [-y, files-mcp]",
        "    env:",
        "      FILES_KEY: secret",
        "    tools:",
        "      include: [read, write]",
      ].join("\n"),
      ["hermes"],
    );
    expect(hermes).toHaveLength(2);
    expect(hermes.find((entry) => entry.name === "stitch")).toMatchObject({
      transport: "http",
      enabled: false,
      url: "https://stitch.example/mcp",
    });
    expect(hermes.find((entry) => entry.name === "files")).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "files-mcp"],
      envKeys: ["FILES_KEY"],
      tools: ["read", "write"],
    });

    const claude = parseClaudeMcpConfig(
      JSON.stringify({
        mcpServers: {
          exa: { command: "npx", args: ["-y", "exa-mcp"], env: { EXA_API_KEY: "x" } },
          remote: { type: "sse", url: "https://remote.example/sse" },
        },
      }),
      ["claude"],
    );
    expect(claude.map((entry) => entry.transport)).toEqual(["stdio", "sse"]);

    const codex = parseCodexMcpConfig(
      [
        "[mcp_servers.docs]",
        'command = "npx"',
        'args = ["-y", "docs-mcp"]',
        "[mcp_servers.docs.env]",
        'DOCS_KEY = "x"',
        "[mcp_servers.remote]",
        'url = "https://codex.example/mcp"',
      ].join("\n"),
      ["codex"],
    );
    expect(codex.find((entry) => entry.name === "docs")).toMatchObject({
      command: "npx",
      args: ["-y", "docs-mcp"],
      envKeys: ["DOCS_KEY"],
    });
    expect(codex.find((entry) => entry.name === "remote")?.transport).toBe("http");

    const opencode = parseOpenCodeMcpConfig(
      JSON.stringify({
        mcp: {
          local: { type: "local", command: ["npx", "-y", "local-mcp"], enabled: true },
          remote: { type: "remote", url: "https://opencode.example/mcp" },
        },
      }),
      ["opencode"],
    );
    expect(opencode.find((entry) => entry.name === "local")).toMatchObject({
      command: "npx",
      args: ["-y", "local-mcp"],
    });
    expect(opencode.find((entry) => entry.name === "remote")?.transport).toBe("http");
  });

  it.effect("reads Hermes session history without a provider round trip", () =>
    withTempHome((home) =>
      Effect.gen(function* () {
        writeFixture(
          home,
          ".hermes/sessions/20261004_055626_8e19d8.jsonl",
          [
            JSON.stringify({ role: "user", content: "Investigate the flaky test" }),
            JSON.stringify({ role: "assistant", content: "On it." }),
          ].join("\n"),
        );
        const result = yield* readNexusSessions({ homeDir: home });
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
          id: "20261004_055626_8e19d8",
          providerInstanceId: "hermes",
          title: "Investigate the flaky test",
          messageCount: 2,
          remote: false,
        });
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );
});

describe("nexus remote ingestion", () => {
  it("parses the record protocol from one SSH round trip", () => {
    const script = buildRemoteIngestionScript();
    expect(script).toContain("@@SKILL");
    expect(script).toContain("@@HERMES_CONFIG");

    const output = parseRemoteIngestionOutput(
      [
        "@@SKILL /home/u/.hermes/skills/ops/incident/SKILL.md",
        "---",
        "name: incident",
        "description: Handle incidents.",
        "---",
        "Body",
        "@@END",
        "@@HERMES_CONFIG",
        "mcp_servers:",
        "  zapier:",
        "    url: https://zapier.example/mcp",
        "@@END",
        "@@SESSION hermes /home/u/.hermes/sessions/abc.jsonl",
      ].join("\n"),
      {
        host: "vps",
        transport: "ssh",
        providerInstanceId: "hermes-vps",
        generatedAt: "2026-10-22T10:00:00.000Z",
      },
    );
    expect(output.skills[0]).toMatchObject({
      id: "hermes:incident",
      providerInstanceId: "hermes-vps",
      description: "Handle incidents.",
    });
    expect(output.mcpServers[0]?.name).toBe("zapier");
    expect(output.sessions[0]).toMatchObject({
      id: "abc",
      providerInstanceId: "hermes-vps",
      remote: true,
    });
  });

  it("maps only enabled stdio servers to ACP descriptors", () => {
    expect(toAcpMcpServer(mcp())).toMatchObject({ name: "exa", command: "npx" });
    expect(toAcpMcpServer(mcp({ enabled: false }))).toBeNull();
    expect(toAcpMcpServer(mcp({ transport: "http", url: "https://x.example/mcp" }))).toBeNull();
  });
});

describe("nexus catalog", () => {
  it.effect("merges local harness state into one catalog with provider summaries", () =>
    withTempHome((home) =>
      Effect.gen(function* () {
        writeFixture(
          home,
          ".hermes/skills/ops/incident/SKILL.md",
          "---\nname: incident\ndescription: Handle incidents.\n---\n",
        );
        writeFixture(
          home,
          ".hermes/config.yaml",
          "mcp_servers:\n  zapier:\n    url: https://zapier.example/mcp\n",
        );
        writeFixture(
          home,
          "app/mcp/rea.json",
          JSON.stringify({
            id: "codeitlab-rea",
            name: "REA",
            transport: "stdio",
            command: "npx",
            args: ["-y", "rea-agents@1.2.3", "--mcp"],
            envKeys: [],
            sources: ["codeitlab", "rea"],
            enabled: true,
            tools: [],
          }),
        );
        writeFixture(
          home,
          "app/mcp/ecosystem.json",
          JSON.stringify({
            mcpServers: {
              graft: {
                command: "graft",
                args: ["mcp"],
                env: { DO_NOT_TRACK: "1" },
                transport: "stdio",
                source: "codeitlab-ecosystem",
              },
            },
          }),
        );
        const providers = [
          {
            instanceId: "hermes",
            driver: "hermes",
            displayName: "Hermes",
            enabled: true,
            installed: true,
            skills: [],
            message: undefined,
          },
        ] as unknown as Parameters<typeof buildNexusCatalog>[0]["providers"];

        const catalog = yield* buildNexusCatalog({
          generatedAt: "2026-10-22T10:00:00.000Z",
          homeDir: home,
          appSkillsDir: NodePath.join(home, "app", "skills"),
          appMcpDir: NodePath.join(home, "app", "mcp"),
          settings: {
            enabled: true,
            includeSkills: true,
            includeSessions: true,
            includeMcp: true,
            injectMcp: true,
            autoInject: true,
            refreshIntervalMins: 15,
            customAcpAgents: [],
          },
          providers,
        });
        expect(catalog.providers[0]).toMatchObject({
          instanceId: "hermes",
          driverKind: "hermes",
          available: true,
          skills: 1,
        });
        expect(catalog.skills.map((entry) => entry.id)).toEqual(["hermes:incident"]);
        expect(catalog.mcpServers.map((entry) => entry.name).toSorted()).toEqual([
          "REA",
          "graft",
          "zapier",
        ]);
        expect(catalog.mcpServers.find((entry) => entry.name === "graft")).toMatchObject({
          command: "graft",
          args: ["mcp"],
          envKeys: ["DO_NOT_TRACK"],
          sources: ["codeitlab-ecosystem"],
        });
        expect(catalog.warnings).toEqual([]);
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  );

  it.effect("skips ingestion when Nexus is disabled", () =>
    Effect.gen(function* () {
      const catalog = yield* buildNexusCatalog({
        generatedAt: "2026-10-22T10:00:00.000Z",
        homeDir: "/nonexistent-nexus-home",
        appSkillsDir: "/nonexistent-nexus-skills",
        appMcpDir: "/nonexistent-nexus-mcp",
        settings: {
          enabled: false,
          includeSkills: true,
          includeSessions: true,
          includeMcp: true,
          injectMcp: false,
          autoInject: false,
          refreshIntervalMins: 15,
          customAcpAgents: [],
        },
        providers: [],
      });
      expect(catalog.skills).toEqual([]);
      expect(catalog.warnings[0]).toContain("disabled");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("nexus instruction block", () => {
  const catalog = (overrides: Partial<NexusCatalog> = {}): NexusCatalog => ({
    generatedAt: "2026-10-22T10:00:00.000Z",
    providers: [
      {
        instanceId: "hermes",
        driverKind: "hermes",
        name: "Hermes",
        transport: "local",
        available: true,
        skills: 1,
        sessions: 1,
        mcpServers: 1,
      },
    ],
    skills: [skill()],
    mcpServers: [mcp({ id: "mcp-1" })],
    sessions: [session()],
    warnings: [],
    ...overrides,
  });

  it("summarizes skills, MCP servers and sessions", () => {
    const block = buildNexusInstructions(catalog());
    expect(block).toContain("## Nexus catalog");
    expect(block).toContain("`review` [hermes]");
    expect(block).toContain("`exa` [stdio; from claude]");
    expect(block).toContain('"Fix auth bug" — hermes');
  });

  it("ranks sessions that match the turn query", () => {
    const block = buildNexusInstructions(
      catalog({
        sessions: [
          session({ id: "a", title: "Deploy pipeline", updatedAt: "2026-10-22T09:00:00.000Z" }),
          session({ id: "b", title: "Auth token bug", updatedAt: "2026-10-20T09:00:00.000Z" }),
        ],
      }),
      { query: "auth token", maxSessions: 1 },
    );
    expect(block).toContain("Auth token bug");
    expect(block).not.toContain("Deploy pipeline");
  });

  it("returns an empty string when there is nothing to inject", () => {
    expect(
      buildNexusInstructions(catalog({ skills: [], mcpServers: [], sessions: [], providers: [] })),
    ).toBe("");
  });
});

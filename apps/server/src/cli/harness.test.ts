// @effect-diagnostics nodeBuiltinImport:off -- CLI integration writes the settings/catalog fixtures the command reads.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { NexusCatalog, ServerSettings } from "@codeitlab/contracts";
import * as NetService from "@codeitlab/shared/Net";
import { it as effectIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { makeCli } from "../binCli.ts";
import {
  buildHarnessRows,
  capabilitiesForHarness,
  formatCommandLine,
  formatHarnessDoctor,
  formatHarnessTable,
  harnessDoctorReport,
  harnessListJson,
  parseCachedAcpRegistry,
  resolveAcpInvocation,
  type HarnessRow,
} from "./harness.ts";

const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeCatalog = Schema.decodeUnknownSync(NexusCatalog);

const settingsFrom = (json: unknown) => decodeSettings(json);

const catalogFrom = (json: unknown) => decodeCatalog(json);

const catalogFixture = catalogFrom({
  generatedAt: "2026-10-22T12:00:00.000Z",
  providers: [
    {
      instanceId: "claudeAgent",
      driverKind: "claudeAgent",
      name: "Claude",
      transport: "local",
      available: true,
      skills: 2,
      sessions: 5,
      mcpServers: 0,
    },
    {
      instanceId: "codex",
      driverKind: "codex",
      name: "Codex",
      transport: "local",
      available: false,
      skills: 0,
      sessions: 0,
      mcpServers: 0,
      detail: "Could not start Codex CLI (`codex`).",
    },
    {
      instanceId: "vps-hermes",
      driverKind: "customAcp",
      name: "Hermes (VPS)",
      transport: "ssh",
      available: true,
      skills: 1,
      sessions: 2,
      mcpServers: 0,
      detail: "Remote harness on vps.example.",
    },
  ],
});

const customAgentsJson = {
  customAcpAgents: [
    {
      id: "vps-hermes",
      name: "Hermes (VPS)",
      command: "hermes",
      args: ["acp"],
      env: { HERMES_HOME: "/srv/hermes" },
      transport: "ssh",
      host: "vps.example",
      enabled: true,
    },
    {
      id: "local-bot",
      name: "Local Bot",
      command: "local-bot",
      args: ["--acp"],
      transport: "local",
      enabled: true,
    },
  ],
};

const settingsFixture = settingsFrom({ codeitlab: { nexus: customAgentsJson } });

const findRow = (rows: ReadonlyArray<HarnessRow>, id: string) => {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`missing row ${id}`);
  return row;
};

describe("codeitlab harness rows", () => {
  it("merges the Nexus catalog with custom ACP agents from settings", () => {
    const rows = buildHarnessRows({ catalog: catalogFixture, settings: settingsFixture });
    expect(rows.map((row) => row.id)).toEqual(["claudeAgent", "codex", "local-bot", "vps-hermes"]);

    const claude = findRow(rows, "claudeAgent");
    expect(claude.enabled).toBe(true);
    expect(claude.available).toBe(true);
    expect(claude.counts).toEqual({ skills: 2, sessions: 5, mcpServers: 0 });
    expect(claude.capabilities).toMatchObject({
      skills: true,
      sessions: true,
      mcp: true,
      acp: false,
    });

    const codex = findRow(rows, "codex");
    expect(codex.enabled).toBe(true);
    expect(codex.available).toBe(false);
    expect(codex.detail).toBe("Could not start Codex CLI (`codex`).");

    const remote = findRow(rows, "vps-hermes");
    expect(remote.transport).toBe("ssh");
    expect(remote.host).toBe("vps.example");
    // Reachability is a doctor probe; list must not claim it.
    expect(remote.available).toBeNull();
    expect(remote.capabilities.acp).toBe(true);

    const local = findRow(rows, "local-bot");
    expect(local.driver).toBe("customAcp");
    expect(local.probe).toEqual({ kind: "binary", command: "local-bot", versionProbe: true });
  });

  it("keeps disabled harnesses out of the usable set and derives capability flags", () => {
    const rows = buildHarnessRows({ catalog: catalogFixture, settings: settingsFixture });
    const report = harnessDoctorReport({
      rows,
      settings: settingsFixture,
      stateDir: "/tmp/codeitlab",
      baseDir: "/tmp/codeitlab",
      catalogGeneratedAt: catalogFixture.generatedAt,
      notes: [],
    });
    expect(report.ok).toBe(false);
    const codex = report.harnesses.find((entry) => entry.id === "codex");
    expect(codex?.reasons).toEqual(["Could not start Codex CLI (`codex`)."]);
    expect(codex?.next[0]).toContain("Install `codex`");

    expect(
      capabilitiesForHarness("codex", { skills: 0, sessions: 0, mcpServers: 0 }),
    ).toMatchObject({
      skills: true,
      sessions: false,
      mcp: true,
      acp: false,
      streaming: true,
    });
    expect(capabilitiesForHarness("hermes", { skills: 0, sessions: 0, mcpServers: 0 }).acp).toBe(
      true,
    );
    // Observed catalog data beats the fallback claim.
    expect(
      capabilitiesForHarness("cursor", { skills: 0, sessions: 3, mcpServers: 0 }).sessions,
    ).toBe(true);
  });
});

describe("codeitlab harness formatting", () => {
  it("prints one table row per harness with capabilities", () => {
    const rows = buildHarnessRows({ catalog: catalogFixture, settings: settingsFixture });
    const table = formatHarnessTable(rows);
    const lines = table.split("\n");
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("CAPABILITIES");
    expect(table).toContain("claudeAgent");
    expect(table).toContain("skills(2), sessions(5), mcp, streaming");
    expect(table).toContain("unavailable");
    expect(table).toContain("unknown");
  });

  it("emits stable JSON with capability flags and counts", () => {
    const rows = buildHarnessRows({ catalog: catalogFixture, settings: settingsFixture });
    const json = harnessListJson({
      rows,
      settings: settingsFixture,
      stateDir: "/tmp/codeitlab",
      baseDir: "/tmp/codeitlab",
      catalogGeneratedAt: catalogFixture.generatedAt,
      notes: [],
    });
    expect(json.schemaVersion).toBe(1);
    expect(json.catalogGeneratedAt).toBe(catalogFixture.generatedAt);
    expect(json.harnesses.map((row) => row.id)).toEqual([
      "claudeAgent",
      "codex",
      "local-bot",
      "vps-hermes",
    ]);
    expect(json.harnesses[0]).toEqual({
      id: "claudeAgent",
      name: "Claude",
      driver: "claudeAgent",
      transport: "local",
      enabled: true,
      available: true,
      status: "available",
      version: null,
      capabilities: { skills: true, sessions: true, mcp: true, acp: false, streaming: true },
      counts: { skills: 2, sessions: 5, mcpServers: 0 },
    });
    expect(json.harnesses[3]).toMatchObject({ host: "vps.example", available: null });
  });

  it("explains unavailable harnesses in doctor output", () => {
    const rows = buildHarnessRows({ catalog: catalogFixture, settings: settingsFixture });
    const text = formatHarnessDoctor({
      rows,
      settings: settingsFixture,
      stateDir: "/tmp/codeitlab",
      baseDir: "/tmp/codeitlab",
      catalogGeneratedAt: catalogFixture.generatedAt,
      notes: [],
    });
    expect(text).toContain("FAIL codex");
    expect(text).toContain("next: Install `codex`");
    expect(text).toContain("Some enabled harnesses are not usable.");
  });
});

describe("codeitlab harness acp", () => {
  const platform = "darwin" as NodeJS.Platform;
  const architecture = "arm64" as NodeJS.Architecture;

  it("prints the local and SSH command lines for custom agents", () => {
    const rows = buildHarnessRows({ catalog: catalogFixture, settings: settingsFixture });
    const remote = resolveAcpInvocation({
      row: findRow(rows, "vps-hermes"),
      settings: settingsFixture,
      platform,
      architecture,
    });
    expect(remote.kind).toBe("acp");
    expect(formatCommandLine(remote.argv)).toBe("ssh vps.example hermes acp");
    expect(remote.envKeys).toEqual(["HERMES_HOME"]);

    const local = resolveAcpInvocation({
      row: findRow(rows, "local-bot"),
      settings: settingsFixture,
      platform,
      architecture,
    });
    expect(formatCommandLine(local.argv)).toBe("local-bot --acp");
  });

  it("resolves Hermes, ACP Registry and native drivers", () => {
    const hermesSettings = settingsFrom({
      providerInstances: { hermes: { driver: "hermes", config: { binaryPath: "/opt/hermes" } } },
    });
    const hermesRow = buildHarnessRows({ catalog: undefined, settings: hermesSettings })[0];
    if (hermesRow === undefined) throw new Error("missing hermes row");
    const hermes = resolveAcpInvocation({
      row: hermesRow,
      settings: hermesSettings,
      platform,
      architecture,
    });
    expect(formatCommandLine(hermes.argv)).toBe("/opt/hermes acp");

    const registrySettings = settingsFrom({
      providerInstances: {
        devin: { driver: "acpRegistry", config: { agentId: "devin" } },
      },
    });
    const registryRows = buildHarnessRows({ catalog: undefined, settings: registrySettings });
    const registryRow = registryRows.find((row) => row.id === "devin");
    if (registryRow === undefined) throw new Error("missing devin row");
    const registry = resolveAcpInvocation({
      row: registryRow,
      settings: registrySettings,
      platform,
      architecture,
      registryAgents: [
        {
          id: "devin",
          version: "1.2.3",
          distribution: { npx: { package: "devin@1.2.3", args: ["--acp"] } },
        },
      ],
    });
    expect(formatCommandLine(registry.argv)).toBe("npx --yes devin@1.2.3 --acp");

    const nativeRow = buildHarnessRows({ catalog: catalogFixture, settings: settingsFixture })[0];
    if (nativeRow === undefined) throw new Error("missing native row");
    const native = resolveAcpInvocation({
      row: nativeRow,
      settings: settingsFixture,
      platform,
      architecture,
    });
    expect(native.kind).toBe("native");
    expect(native.argv).toEqual(["claude"]);
  });

  it("parses the cached ACP Registry index and rejects junk", () => {
    const parsed = parseCachedAcpRegistry({
      version: "1",
      agents: [
        {
          id: "devin",
          version: "1.2.3",
          distribution: {
            npx: { package: "devin@1.2.3", args: ["--acp"], env: { DEVIN_TOKEN: "x" } },
            binary: { "darwin-aarch64": { cmd: "devin", args: [] } },
          },
        },
        { id: "missing-distribution" },
        "junk",
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.distribution.npx?.package).toBe("devin@1.2.3");
    expect(parsed?.[0]?.distribution.binary?.["darwin-aarch64"]?.cmd).toBe("devin");
    expect(parseCachedAcpRegistry({ agents: "nope" })).toBeUndefined();
  });

  it("quotes command arguments that need a shell", () => {
    expect(formatCommandLine(["echo", "a b", "it's"])).toBe("echo 'a b' 'it'\\''s'");
  });
});

describe("codeitlab harness command", () => {
  effectIt.effect("prints list JSON from a temp CodeItLab home", () => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "codeitlab-harness-cli-"));
    const stateDir = NodePath.join(baseDir, "userdata");
    NodeFS.mkdirSync(NodePath.join(stateDir, "codeitlab", "nexus"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(stateDir, "settings.json"),
      `${JSON.stringify({ codeitlab: { nexus: customAgentsJson } })}\n`,
    );
    NodeFS.writeFileSync(
      NodePath.join(stateDir, "codeitlab", "nexus", "catalog.json"),
      `${JSON.stringify(catalogFixture)}\n`,
    );
    const effect = Effect.gen(function* () {
      yield* Command.runWith(makeCli(), { version: "0.0.0" })([
        "harness",
        "list",
        "--json",
        "--base-dir",
        baseDir,
      ]);
      const output = (yield* TestConsole.logLines).join("\n");
      return JSON.parse(output) as {
        schemaVersion: number;
        harnesses: ReadonlyArray<{ id: string }>;
      };
    }).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer)),
    );
    return effect.pipe(
      Effect.map((result) => {
        expect(result.schemaVersion).toBe(1);
        expect(result.harnesses.map((row) => row.id)).toEqual([
          "claudeAgent",
          "codex",
          "local-bot",
          "vps-hermes",
        ]);
      }),
    );
  });
});

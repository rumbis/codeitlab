// @effect-diagnostics nodeBuiltinImport:off -- the fake REA CLI is a real executable script on disk.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { ReaService } from "@codeitlab/core/services";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { describe } from "vite-plus/test";

import * as ProcessRunner from "../../processRunner.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Rea from "./ReaService.ts";
import { reaServerArgs } from "./mcp.ts";

const decodeJsonUnknown = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const fakeCliDirectory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "codeitlab-rea-cli-"));
const fakeCliPath = NodePath.join(fakeCliDirectory, "rea-fake.mjs");

NodeFS.writeFileSync(
  fakeCliPath,
  `const command = process.argv[2];
const emit = (value) => { process.stdout.write(JSON.stringify(value)); process.exit(0); };
if (command === "--version") { process.stdout.write("6.7.0\\n"); process.exit(0); }
if (command === "doctor") emit({ scope_checks: [
  { name: "skill_identity", ok: true, classification: "ok", detail: "skill registered" },
  { name: "hopper", ok: false, detail: "hopper engine missing", remediation: "install hopper" },
] });
if (command === "mcp") emit({ checks: [{ name: "protocol", ok: true, detail: "2025-11-25" }],
  server: { version: "6.7.0" }, inventory: { tools: { observed: 207, expected: 207 } } });
if (command === "capabilities") emit({ capabilities: [
  { provider: { id: "electron", name: "Electron apps" },
    groups: [{ effects: ["read", "launch_process"] }],
    shared_limitations: ["Static analysis only."] },
] });
process.exit(1);
`,
);

const fakeReaSettings = {
  codeitlab: {
    rea: {
      mcpCommand: process.execPath,
      mcpArgs: [fakeCliPath, "--mcp"],
      installSkill: true,
    },
  },
};

const makeLayer = (prefix: string) =>
  Rea.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix }),
        ServerSettings.layerTest(fakeReaSettings),
        ProcessRunner.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );

describe("REA CLI argument handling", () => {
  it("always invokes the verified stdio-server form", () => {
    assert.deepEqual(
      reaServerArgs({
        mcpCommand: "npx",
        mcpArgs: ["-y", "rea-agents@6.7.0"],
        installSkill: true,
        enabled: true,
        autoActivate: true,
      }),
      ["-y", "rea-agents@6.7.0", "--mcp"],
    );
    assert.deepEqual(
      reaServerArgs({
        mcpCommand: "npx",
        mcpArgs: ["-y", "rea-agents@6.7.0", "mcp"],
        installSkill: true,
        enabled: true,
        autoActivate: true,
      }),
      ["-y", "rea-agents@6.7.0", "--mcp"],
    );
  });

  it("parses doctor, mcp doctor, version and capability output", () => {
    const doctor = Rea.parseDoctorHealth(
      JSON.stringify({ scope_checks: [{ name: "hopper", ok: false, detail: "missing" }] }),
    );
    assert.strictEqual(doctor[0]?.name, "doctor:hopper");
    assert.strictEqual(doctor[0]?.ok, false);

    const mcp = Rea.parseMcpDoctorHealth(
      JSON.stringify({
        checks: [{ name: "protocol", ok: true }],
        server: { version: "6.7.0" },
        inventory: { tools: { observed: 207, expected: 207 } },
      }),
    );
    assert.strictEqual(
      mcp.some((check) => check.name === "mcp:inventory"),
      true,
    );
    assert.strictEqual(Rea.parseReaVersion("rea 6.7.0\n"), "6.7.0");

    const capabilities = Rea.parseCapabilities(
      JSON.stringify({
        capabilities: [
          {
            provider: { id: "electron", name: "Electron apps" },
            groups: [{ effects: ["read"] }],
            shared_limitations: ["Static analysis only."],
          },
        ],
      }),
    );
    assert.strictEqual(capabilities[0]?.id, "electron");
    assert.deepEqual(capabilities[0]?.sideEffects, ["read"]);
  });
});

it.layer(makeLayer("codeitlab-rea-test-"))("ReaService", (it) => {
  it.effect("registers the MCP server, seeds the skill, and reports real health", () =>
    Effect.gen(function* () {
      const rea = yield* ReaService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const installed = yield* rea.ensureInstalled;
      assert.strictEqual(installed.installed, true);
      assert.strictEqual(installed.version, "6.7.0");
      assert.strictEqual(installed.skillInstalled, true);
      assert.strictEqual(
        installed.health.some((check) => check.name === "doctor:hopper" && !check.ok),
        true,
      );
      assert.strictEqual(
        installed.health.some((check) => check.name === "mcp:inventory" && check.ok),
        true,
      );

      const registrationPath = path.join(config.stateDir, "codeitlab", "mcp", "rea.json");
      assert.strictEqual(yield* fs.exists(registrationPath), true);
      const registrationText = yield* fs.readFileString(registrationPath);
      const registration = yield* decodeJsonUnknown(registrationText);
      const record = registration as { id?: string; args?: ReadonlyArray<string> };
      assert.strictEqual(record.id, "codeitlab-rea");
      assert.deepEqual(record.args, [fakeCliPath, "--mcp"]);

      assert.strictEqual(
        yield* fs.exists(path.join(config.stateDir, "codeitlab", "skills", "rea", "SKILL.md")),
        true,
      );
    }),
  );

  it.effect("lists capabilities from the CLI with an offline fallback", () =>
    Effect.gen(function* () {
      const rea = yield* ReaService;
      const capabilities = yield* rea.capabilities;
      assert.strictEqual(capabilities[0]?.id, "electron");
      assert.strictEqual(capabilities[0]?.description, "Static analysis only.");
    }),
  );
});

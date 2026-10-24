import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { DEFAULT_CODEITLAB_SETTINGS, EcosystemService } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { describe, expect } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import { ProcessRunner } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { layer } from "./EcosystemService.ts";

const graftInstalled = Layer.succeed(ProcessRunner, {
  run: (input: Parameters<ProcessRunner["Service"]["run"]>[0]) =>
    Effect.succeed({
      stdout: input.args[0] === "--version" ? "0.21.1\n" : "",
      stderr: "",
      code: 0,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    }),
} as unknown as ProcessRunner["Service"]);

const graftMissing = Layer.succeed(ProcessRunner, {
  run: () =>
    Effect.succeed({
      stdout: "",
      stderr: "command not found: graft",
      code: 127,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    }),
} as unknown as ProcessRunner["Service"]);

const settingsLayer = ServerSettingsService.layerTest({
  codeitlab: DEFAULT_CODEITLAB_SETTINGS,
});

const configLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "ecosystem-service-test-",
}).pipe(Layer.provide(NodeServices.layer));

const testLayer = layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(settingsLayer, configLayer, NodeServices.layer, graftInstalled),
  ),
);

const missingLayer = layer.pipe(
  Layer.provideMerge(Layer.mergeAll(settingsLayer, configLayer, NodeServices.layer, graftMissing)),
);

describe("EcosystemService layer", () => {
  it.effect("reports the three integrations with real modes", () =>
    Effect.gen(function* () {
      const service = yield* EcosystemService;
      const status = yield* service.status;
      const byId = Object.fromEntries(status.integrations.map((i) => [i.id, i]));
      expect(byId.graft?.kind).toBe("mcp");
      expect(byId.graft?.version).toBe("0.21.1");
      expect(byId.graft?.available).toBe(true);
      expect(byId.ponytail?.mode).toBe("full");
      expect(byId.ponytail?.enabled).toBe(true);
      expect(byId.terse?.mode).toBe("lite");
      expect(byId.terse?.enabled).toBe(true);
      expect(status.warnings).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("install seeds skills and the Graft MCP registration", () =>
    Effect.gen(function* () {
      const service = yield* EcosystemService;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const result = yield* service.install;
      expect(result.written.length).toBe(4);

      const skills = path.join(config.stateDir, "codeitlab", "skills");
      for (const id of ["graft", "ponytail", "caveman"]) {
        const body = yield* fs.readFileString(path.join(skills, id, "SKILL.md"));
        expect(body.length).toBeGreaterThan(100);
      }

      const registration = yield* fs.readFileString(
        path.join(config.stateDir, "codeitlab", "mcp", "ecosystem.json"),
      );
      expect(JSON.parse(registration)).toMatchObject({
        mcpServers: {
          graft: { command: "graft", args: ["mcp"], env: { DO_NOT_TRACK: "1" } },
        },
      });
      expect(result.status.integrations.map((i) => i.id)).toEqual(["graft", "ponytail", "terse"]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("a missing graft binary is a warning, not a failure", () =>
    Effect.gen(function* () {
      const service = yield* EcosystemService;
      const status = yield* service.status;
      const graft = status.integrations.find((i) => i.id === "graft");
      expect(graft?.available).toBe(false);
      expect(graft?.detail).toContain("Not installed");
      expect(status.warnings.join(" ")).toContain("graft");
    }).pipe(Effect.provide(missingLayer)),
  );
});

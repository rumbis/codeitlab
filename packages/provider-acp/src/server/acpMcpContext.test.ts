import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { NodeServices } from "@effect/platform-node";

import { DEFAULT_CODEITLAB_SETTINGS } from "@codeitlab/contracts";
import type * as McpProviderSession from "@codeitlab/provider-core/server/mcpSession";

import {
  buildAcpMcpContext,
  ecosystemMcpInjectionEnabled,
  readEcosystemMcpServers,
  toAcpExtraMcpServer,
  type AcpExtraMcpServer,
} from "./acpMcpContext.ts";

const SELF = {
  command: "/usr/local/bin/codeitlab",
  argsPrefix: [],
  entrypoint: undefined,
} as unknown as Parameters<typeof buildAcpMcpContext>[1];

const session = {
  endpoint: "http://127.0.0.1:1234/mcp",
  authorizationHeader: "Bearer test",
} as unknown as McpProviderSession.McpProviderSessionConfig;

const extra = (
  name: string,
  command: string,
  env: Record<string, string> = {},
): AcpExtraMcpServer => ({
  name,
  command,
  args: ["mcp"],
  env: Object.entries(env).map(([key, value]) => ({ name: key, value })),
});

describe("ACP MCP context", () => {
  it("keeps codeitlab-code and adds the ecosystem servers after it", () => {
    const context = buildAcpMcpContext(session, SELF, [
      extra("graft", "/opt/homebrew/bin/graft", { DO_NOT_TRACK: "1" }),
      extra("rea", "/usr/local/bin/npx"),
    ]);
    expect(context.servers.map((server) => server.name)).toEqual([
      "codeitlab-code",
      "graft",
      "rea",
    ]);
    expect((context.servers[1] as { env?: unknown } | undefined)?.env).toEqual([
      { name: "DO_NOT_TRACK", value: "1" },
    ]);
    expect(context.acpServers).toEqual([
      { type: "acp", name: "codeitlab-code", serverId: "codeitlab-code" },
    ]);
  });

  it("dedupes by command, args and env keys, never by display name", () => {
    const context = buildAcpMcpContext(session, SELF, [
      extra("graft", "/opt/homebrew/bin/graft", { DO_NOT_TRACK: "1" }),
      extra("graft-copy", "/opt/homebrew/bin/graft", { DO_NOT_TRACK: "1" }),
      extra("graft-telemetry", "/opt/homebrew/bin/graft", { DO_NOT_TRACK: "1", OTHER: "x" }),
    ]);
    expect(context.servers.map((server) => server.name)).toEqual([
      "codeitlab-code",
      "graft",
      "graft-telemetry",
    ]);
  });

  it("still advertises ecosystem servers without a CodeItLab MCP session", () => {
    const context = buildAcpMcpContext(undefined, SELF, [
      extra("graft", "/opt/homebrew/bin/graft"),
    ]);
    expect(context.servers.map((server) => server.name)).toEqual(["graft"]);
    expect(context.acpServers).toEqual([]);
    expect(context.processEnvironment).toBeUndefined();
  });

  it("defaults the injection gate on and respects both switches", () => {
    expect(DEFAULT_CODEITLAB_SETTINGS.nexus.injectMcp).toBe(true);
    expect(ecosystemMcpInjectionEnabled(DEFAULT_CODEITLAB_SETTINGS.nexus)).toBe(true);
    expect(ecosystemMcpInjectionEnabled({ enabled: false, injectMcp: true })).toBe(false);
    expect(ecosystemMcpInjectionEnabled({ enabled: true, injectMcp: false })).toBe(false);
    expect(ecosystemMcpInjectionEnabled(undefined)).toBe(false);
  });
});

describe("app-managed ecosystem registrations", () => {
  const layer = NodeServices.layer;

  it.effect("reads both registration shapes and skips a missing binary with a warning", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectory();
      const mcpDir = `${stateDir}/codeitlab/mcp`;
      yield* fs.makeDirectory(mcpDir, { recursive: true });

      // REA writes a single NexusMcpServer.
      yield* fs.writeFileString(
        `${mcpDir}/rea.json`,
        JSON.stringify({
          id: "rea",
          name: "rea",
          transport: "stdio",
          command: "/bin/sh",
          args: ["-c", "true"],
          envKeys: [],
          sources: ["rea"],
          enabled: true,
          tools: [],
        }),
      );
      // The ecosystem installer writes the envelope shape.
      yield* fs.writeFileString(
        `${mcpDir}/ecosystem.json`,
        JSON.stringify({
          mcpServers: {
            graft: {
              command: "/bin/sh",
              args: ["-c", "true"],
              env: { DO_NOT_TRACK: "1" },
              transport: "stdio",
              source: "codeitlab-ecosystem",
            },
            broken: {
              command: "definitely-not-a-real-binary-xyz",
              args: [],
              transport: "stdio",
              source: "codeitlab-ecosystem",
            },
            remote: { url: "https://example.com/mcp", transport: "http" },
          },
        }),
      );
      yield* fs.writeFileString(`${mcpDir}/junk.json`, "not json at all");

      const result = yield* readEcosystemMcpServers({
        stateDir,
        environment: { PATH: "/usr/bin:/bin:/usr/local/bin" },
      });

      expect(result.servers.map((server) => server.name).toSorted()).toEqual(["graft", "rea"]);
      const graft = result.servers.find((server) => server.name === "graft");
      expect(graft?.env).toEqual([{ name: "DO_NOT_TRACK", value: "1" }]);
      const warnings = result.warnings.join("\n");
      expect(warnings).toContain("definitely-not-a-real-binary-xyz");
      expect(warnings).toContain("remote");
      expect(warnings).toContain("junk.json");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a missing registration directory is empty, not an error", () =>
    Effect.gen(function* () {
      const result = yield* readEcosystemMcpServers({
        stateDir: "/tmp/codeitlab-no-such-state-dir-xyz",
        environment: { PATH: "/usr/bin:/bin" },
      });
      expect(result.servers).toEqual([]);
      expect(result.warnings).toEqual([]);
    }).pipe(Effect.provide(layer)),
  );

  it("drops non-stdio registrations before they reach ACP", () => {
    const mapped = toAcpExtraMcpServer({
      server: {
        id: "http",
        name: "remote",
        transport: "http",
        url: "https://example.com/mcp",
        args: [],
        envKeys: [],
        sources: ["codeitlab"],
        enabled: true,
        tools: [],
      },
      env: {},
    });
    expect(mapped).toBeUndefined();
  });
});

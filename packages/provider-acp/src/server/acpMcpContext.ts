import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import type * as EffectAcpSchema from "effect-acp/compat";

import type * as McpProviderSession from "@codeitlab/provider-core/server/mcpSession";
import {
  appManagedMcpDirectory,
  commandIsAvailable,
  mcpServerIdentity,
  readAppManagedMcpServers,
  type AppManagedMcpServer,
} from "@codeitlab/shared/codeitlabMcp";
import { type SelfInvocation, selfInvocationArgs } from "@codeitlab/shared/nodeRuntime";

/**
 * The MCP activation payload handed to an ACP session. CodeItLab's own `codeitlab-code`
 * bridge is always present; app-managed ecosystem servers (Graft, REA) are
 * merged in additively and deduped by fingerprint so a harness that already
 * advertises the same command/args does not get a duplicate.
 */
export interface AcpMcpContext {
  readonly servers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly acpServers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly processEnvironment?: NodeJS.ProcessEnv;
  readonly endpoint?: string;
  readonly authorization?: string;
}

export interface AcpExtraMcpServer {
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

export const toAcpExtraMcpServer = (server: AppManagedMcpServer): AcpExtraMcpServer | undefined => {
  if (server.server.transport !== "stdio" || server.server.command === undefined) return undefined;
  return {
    name: server.server.name,
    command: server.server.command,
    args: server.server.args,
    env: Object.entries(server.env)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => ({ name, value })),
  };
};

const descriptorFingerprint = (server: {
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}): string =>
  mcpServerIdentity({
    transport: "stdio",
    command: server.command,
    args: server.args,
    envKeys: server.env.map((entry) => entry.name),
  });

const CilCodeServer = (
  session: McpProviderSession.McpProviderSessionConfig,
  self: SelfInvocation,
) => ({
  name: "codeitlab-code",
  command: self.command,
  args: [...selfInvocationArgs(self, ["acp-mcp-bridge"])],
  env: [
    { name: "ELECTRON_RUN_AS_NODE", value: "1" },
    { name: "CIL_ACP_MCP_ENDPOINT", value: session.endpoint },
    { name: "CIL_ACP_MCP_AUTHORIZATION", value: session.authorizationHeader },
  ],
});

/**
 * Build the MCP context for a session. When the CodeItLab MCP session is missing the
 * ecosystem servers are still advertised: they do not depend on CodeItLab's endpoint.
 */
export const buildAcpMcpContext = (
  session: McpProviderSession.McpProviderSessionConfig | undefined,
  self: SelfInvocation,
  extra: ReadonlyArray<AcpExtraMcpServer> = [],
): AcpMcpContext => {
  const servers: Array<EffectAcpSchema.McpServer> = [];
  const seen = new Set<string>();
  if (session !== undefined) {
    const codeitlab = CilCodeServer(session, self);
    seen.add(descriptorFingerprint(codeitlab));
    servers.push(codeitlab);
  }
  for (const candidate of extra) {
    const fingerprint = descriptorFingerprint(candidate);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    servers.push(candidate);
  }
  if (session === undefined) {
    return { servers, acpServers: [] };
  }
  // Agents that advertise optional http support still routinely fail to wire
  // injected http servers through to their backend (codex-acp 1.2.0 and pi-acp
  // both drop them), so every ACP session gets the `codeitlab acp-mcp-bridge` stdio
  // server, which forwards JSON-RPC to CodeItLab's authenticated MCP endpoint.
  return {
    servers,
    acpServers: [{ type: "acp", name: "codeitlab-code", serverId: "codeitlab-code" }],
    endpoint: session.endpoint,
    authorization: session.authorizationHeader,
    processEnvironment: {
      CIL_ACP_MCP_ENDPOINT: session.endpoint,
      CIL_ACP_MCP_AUTHORIZATION: session.authorizationHeader,
      CIL_ACP_MCP_NODE: self.command,
      ...(self.entrypoint === undefined ? {} : { CIL_ACP_MCP_ENTRYPOINT: self.entrypoint }),
    },
  };
};

export const acpMcpActivation = (context: AcpMcpContext) => ({
  mcpServers: context.servers,
  acpMcpServers: context.acpServers,
});

/**
 * Gate for ecosystem MCP injection. Nexus must be enabled and the explicit
 * injection flag on; both default on, so tools work without the user asking.
 */
export const ecosystemMcpInjectionEnabled = (
  nexus: { readonly enabled: boolean; readonly injectMcp: boolean } | undefined,
): boolean => nexus !== undefined && nexus.enabled && nexus.injectMcp;

/**
 * Read the app-managed ecosystem registrations and keep only what an ACP
 * session can actually spawn: stdio servers whose command resolves on PATH.
 * Everything else is a warning, never a session failure — a missing Graft
 * binary must not take the turn down.
 */
export const readEcosystemMcpServers = (input: {
  readonly stateDir: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): Effect.Effect<
  { readonly servers: ReadonlyArray<AcpExtraMcpServer>; readonly warnings: ReadonlyArray<string> },
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const result = yield* readAppManagedMcpServers({
      directory: appManagedMcpDirectory(input.stateDir),
    });
    const servers: Array<AcpExtraMcpServer> = [];
    const warnings: Array<string> = [...result.warnings];
    for (const appManaged of result.servers) {
      const extra = toAcpExtraMcpServer(appManaged);
      if (extra === undefined) {
        warnings.push(
          `Skipped app-managed MCP server '${appManaged.server.name}': ${appManaged.server.transport} transport cannot be injected into an ACP session.`,
        );
        continue;
      }
      const available = yield* commandIsAvailable(extra.command, input.environment);
      if (!available) {
        warnings.push(
          `Skipped app-managed MCP server '${extra.name}': command '${extra.command}' was not found on PATH.`,
        );
        continue;
      }
      servers.push(extra);
    }
    return { servers, warnings };
  });

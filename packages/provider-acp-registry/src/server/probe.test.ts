import { assert, it } from "@effect/vitest";
import type * as AcpSchema from "effect-acp/compat";

import { metaTerminalAuth, normalizeAcpRegistryAuthMethods } from "./probe.ts";

it("reads the terminal-auth meta extension and its args", () => {
  const method = {
    id: "setup",
    name: "Amp API Key Setup",
    _meta: { "terminal-auth": { command: "/managed/amp-acp", args: ["--setup"], label: "Setup" } },
  } as unknown as AcpSchema.AuthMethod;
  assert.deepEqual(metaTerminalAuth(method), { command: "/managed/amp-acp", args: ["--setup"] });
  const [normalized] = normalizeAcpRegistryAuthMethods([method]);
  assert.strictEqual(normalized?.type, "terminal");
  assert.strictEqual(normalized?.command, "/managed/amp-acp --setup");
});

it("ignores malformed terminal-auth metadata", () => {
  const method = {
    id: "setup",
    name: "Setup",
    _meta: { "terminal-auth": { args: ["--setup"] } },
  } as unknown as AcpSchema.AuthMethod;
  assert.isUndefined(metaTerminalAuth(method));
  const [normalized] = normalizeAcpRegistryAuthMethods([method]);
  assert.strictEqual(normalized?.type, "agent");
});

it("leaves declared terminal methods on the spawn command", () => {
  const method = {
    id: "login",
    name: "Login",
    type: "terminal",
    args: ["--login"],
  } as unknown as AcpSchema.AuthMethod;
  const [normalized] = normalizeAcpRegistryAuthMethods([method], {
    command: "/managed/agent",
    args: ["acp"],
  });
  assert.strictEqual(normalized?.type, "terminal");
  assert.strictEqual(normalized?.command, "/managed/agent acp --login");
});

it("maps curated CLI-setup agents to a terminal method", () => {
  const method = {
    id: "goose-provider",
    name: "Configure Provider",
  } as unknown as AcpSchema.AuthMethod;
  const [normalized] = normalizeAcpRegistryAuthMethods(
    [method],
    { command: "/managed/goose", args: ["acp"] },
    "goose",
  );
  assert.strictEqual(normalized?.type, "terminal");
  assert.strictEqual(normalized?.command, "/managed/goose configure");
});

it("does not invent a terminal command for uncurated agents", () => {
  const method = { id: "browser", name: "Browser" } as unknown as AcpSchema.AuthMethod;
  const [normalized] = normalizeAcpRegistryAuthMethods(
    [method],
    { command: "/managed/agent", args: ["acp"] },
    "some-agent",
  );
  assert.strictEqual(normalized?.type, "agent");
  assert.isUndefined(normalized?.command);
});

it("maps factory-droid to its interactive login TUI", () => {
  const method = { id: "device-pairing", name: "Login" } as unknown as AcpSchema.AuthMethod;
  const [normalized] = normalizeAcpRegistryAuthMethods(
    [method],
    { command: "npx", args: ["-y", "droid@0.248.0", "exec", "--output-format", "acp-daemon"] },
    "factory-droid",
  );
  assert.strictEqual(normalized?.type, "terminal");
  assert.strictEqual(normalized?.command, "npx");
});

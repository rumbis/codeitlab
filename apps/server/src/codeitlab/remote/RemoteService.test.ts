import type * as NodeOS from "node:os";
import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import type * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import type * as ServerConfig from "../../config.ts";
import type * as ProcessRunner from "../../processRunner.ts";
import { makeRemoteService } from "./RemoteService.ts";

const TAILSCALE_JSON = JSON.stringify({
  BackendState: "Running",
  Self: {
    DNSName: "studio-mac.tail1234.ts.net.",
    TailscaleIPs: ["100.125.101.79", "fd7a:115c:a1e0::8b37:6551"],
  },
  HaveNodeKey: true,
});

const config = (overrides: Partial<ServerConfig.ServerConfig["Service"]> = {}) =>
  ({
    host: "0.0.0.0",
    port: 4797,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
    ...overrides,
  }) as unknown as ServerConfig.ServerConfig["Service"];

const processRunner = (result: {
  readonly stdout: string;
  readonly code: number;
  readonly stderr?: string;
}) =>
  ({
    run: () =>
      Effect.succeed({
        stdout: result.stdout,
        stderr: result.stderr ?? "",
        code: result.code,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      }),
  }) as unknown as ProcessRunner.ProcessRunner["Service"];

const auth = (expiresAt: DateTime.Utc) =>
  ({
    createPairingLink: () =>
      Effect.succeed({
        id: "pair-1",
        credential: "tok-abc",
        scopes: ["read", "write"],
        subject: "cli-issued-session",
        label: "CodeitLab Remote",
        createdAt: expiresAt,
        expiresAt,
      }),
  }) as unknown as EnvironmentAuth.EnvironmentAuth["Service"];

const interfacesWithTailnet = () =>
  ({
    en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
    utun4: [
      { address: "100.125.101.79", family: "IPv4", internal: false },
      { address: "fd7a:115c:a1e0::8b37:6551", family: "IPv6", internal: false },
    ],
  }) as unknown as ReturnType<typeof NodeOS.networkInterfaces>;

const service = (options: {
  readonly config?: ServerConfig.ServerConfig["Service"];
  readonly runner?: ProcessRunner.ProcessRunner["Service"];
  readonly interfaces?: ReturnType<typeof NodeOS.networkInterfaces>;
}) =>
  makeRemoteService({
    config: options.config ?? config(),
    processRunner: options.runner ?? processRunner({ stdout: TAILSCALE_JSON, code: 0 }),
    auth: auth(DateTime.makeUnsafe("2026-10-22T16:00:00.000Z")),
    interfaces: options.interfaces ?? interfacesWithTailnet(),
  });

describe("RemoteService", () => {
  it.effect("reports the tailnet and the reachable URLs for a wildcard bind", () =>
    Effect.gen(function* () {
      const remote = service({});
      const status = yield* remote.status;
      expect(status.tailnet.available).toBe(true);
      expect(status.tailnet.running).toBe(true);
      expect(status.tailnet.dnsName).toBe("studio-mac.tail1234.ts.net");
      expect(status.tailnet.hostname).toBe("studio-mac");
      expect(status.tailnet.ipv4).toBe("100.125.101.79");
      expect(status.server.loopbackOnly).toBe(false);
      expect(status.server.urls).toContain("http://100.125.101.79:4797/");
      expect(status.detail).toBeUndefined();
    }),
  );

  it.effect("warns when the server only listens on loopback", () =>
    Effect.gen(function* () {
      const remote = service({ config: config({ host: undefined }) });
      const status = yield* remote.status;
      expect(status.server.loopbackOnly).toBe(true);
      expect(status.server.urls).toEqual([]);
      expect(status.detail).toContain("only listens on loopback");
      expect(status.tailnet.running).toBe(true);
    }),
  );

  it.effect("advertises the Tailscale Serve URL for a loopback server when serve is on", () =>
    Effect.gen(function* () {
      const remote = service({
        config: config({ host: "127.0.0.1", tailscaleServeEnabled: true }),
      });
      const status = yield* remote.status;
      expect(status.server.urls).toEqual(["https://studio-mac.tail1234.ts.net/"]);
    }),
  );

  it.effect("degrades honestly when the Tailscale CLI is missing", () =>
    Effect.gen(function* () {
      const remote = service({
        runner: processRunner({ stdout: "", stderr: "tailscale: command not found", code: 127 }),
      });
      const status = yield* remote.status;
      expect(status.tailnet.available).toBe(false);
      expect(status.tailnet.running).toBe(false);
      expect(status.tailnet.detail).toContain("Install Tailscale");
    }),
  );

  it.effect("reports an installed but stopped tailnet", () =>
    Effect.gen(function* () {
      const remote = service({
        runner: processRunner({ stdout: "", stderr: "Tailscale is stopped.", code: 1 }),
      });
      const status = yield* remote.status;
      expect(status.tailnet.available).toBe(true);
      expect(status.tailnet.running).toBe(false);
      expect(status.tailnet.detail).toContain("not running");
    }),
  );

  it.effect("mints a pairing link against the first reachable URL", () =>
    Effect.gen(function* () {
      const remote = service({});
      const link = yield* remote.createPairingLink;
      expect(link.url).toBe("http://100.125.101.79:4797/pair#token=tok-abc");
      expect(link.expiresAt).toBe("2026-10-22T16:00:00.000Z");
      expect(link.scopes).toEqual(["read", "write"]);
      expect(link.label).toBe("CodeitLab Remote");
    }),
  );

  it.effect("prefers the Tailscale Serve HTTPS URL for the pairing link", () =>
    Effect.gen(function* () {
      const remote = service({
        config: config({ host: "127.0.0.1", tailscaleServeEnabled: true }),
      });
      const status = yield* remote.status;
      expect(status.server.urls).toEqual(["https://studio-mac.tail1234.ts.net/"]);
      const link = yield* remote.createPairingLink;
      expect(link.url).toBe("https://studio-mac.tail1234.ts.net/pair#token=tok-abc");
    }),
  );

  it.effect(
    "falls back to the loopback URL when nothing is reachable, so the link is never broken",
    () =>
      Effect.gen(function* () {
        const remote = service({ config: config({ host: undefined }) });
        const link = yield* remote.createPairingLink;
        expect(link.url).toBe("http://127.0.0.1:4797/pair#token=tok-abc");
      }),
  );

  it.effect("caches the tailnet probe between status reads", () =>
    Effect.gen(function* () {
      let calls = 0;
      const runner = {
        run: () => {
          calls += 1;
          return Effect.succeed({
            stdout: TAILSCALE_JSON,
            stderr: "",
            code: 0,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          });
        },
      } as unknown as ProcessRunner.ProcessRunner["Service"];
      const remote = service({ runner });
      yield* remote.status;
      yield* remote.status;
      expect(calls).toBe(1);
    }),
  );
});

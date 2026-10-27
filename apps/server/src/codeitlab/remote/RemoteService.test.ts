import type * as NodeOS from "node:os";
import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import type * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import type * as ServerConfig from "../../config.ts";
import type * as ProcessRunner from "../../processRunner.ts";
import type {
  CloudflaredProbe,
  CloudflaredStartOptions,
  CloudflaredTunnelLauncher,
} from "./cloudflared.ts";
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
        label: "CodeItLab Remote",
        createdAt: expiresAt,
        expiresAt,
      }),
  }) as unknown as EnvironmentAuth.EnvironmentAuth["Service"];

/**
 * In-memory launcher: each start hands out the next quick-tunnel URL, so a
 * refresh visibly changes the address, and the counters show what the service
 * actually asked for.
 */
const fakeTunnel = (
  options: {
    readonly probe?: CloudflaredProbe;
    readonly urls?: ReadonlyArray<string>;
    readonly startError?: Error;
  } = {},
) => {
  const calls = {
    probe: 0,
    start: [] as Array<CloudflaredStartOptions>,
    stop: 0,
  };
  const urls = options.urls ?? [
    "https://first-words-here.trycloudflare.com/",
    "https://second-words-here.trycloudflare.com/",
  ];
  let starts = 0;
  const launcher: CloudflaredTunnelLauncher = {
    probe: () => {
      calls.probe += 1;
      return Promise.resolve(options.probe ?? { available: true, version: "2026.10.3" });
    },
    start: (startOptions) => {
      calls.start.push(startOptions);
      if (options.startError !== undefined) return Promise.reject(options.startError);
      const url = urls[Math.min(starts, urls.length - 1)] ?? urls[0]!;
      starts += 1;
      return Promise.resolve({
        url,
        stop: () => {
          calls.stop += 1;
        },
      });
    },
  };
  return { launcher, calls };
};

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
  readonly tunnel?: CloudflaredTunnelLauncher;
  readonly hostedAppUrl?: string;
}) =>
  makeRemoteService({
    config: options.config ?? config(),
    processRunner: options.runner ?? processRunner({ stdout: TAILSCALE_JSON, code: 0 }),
    auth: auth(DateTime.makeUnsafe("2026-10-22T16:00:00.000Z")),
    interfaces: options.interfaces ?? interfacesWithTailnet(),
    tunnel: options.tunnel ?? fakeTunnel().launcher,
    ...(options.hostedAppUrl === undefined ? {} : { hostedAppUrl: options.hostedAppUrl }),
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
      expect(link.hostedUrl).toBeUndefined();
      expect(link.expiresAt).toBe("2026-10-22T16:00:00.000Z");
      expect(link.scopes).toEqual(["read", "write"]);
      expect(link.label).toBe("CodeItLab Remote");
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
        expect(link.hostedUrl).toBeUndefined();
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

  it.effect("advertises the running tunnel URL first, with its version", () =>
    Effect.gen(function* () {
      const { launcher, calls } = fakeTunnel();
      const remote = service({ tunnel: launcher });
      const started = yield* remote.manageTunnel({ action: "start" });
      expect(calls.start).toEqual([{ localPort: 4797, localHost: "127.0.0.1" }]);
      expect(started.tunnel).toMatchObject({
        available: true,
        running: true,
        url: "https://first-words-here.trycloudflare.com/",
        version: "2026.10.3",
      });
      expect(started.server.urls[0]).toBe("https://first-words-here.trycloudflare.com/");
    }),
  );

  it.effect("mints the pairing link against the tunnel and adds the hosted PWA link", () =>
    Effect.gen(function* () {
      const { launcher } = fakeTunnel();
      const remote = service({ tunnel: launcher });
      yield* remote.manageTunnel({ action: "start" });
      const link = yield* remote.createPairingLink;
      expect(link.url).toBe("https://first-words-here.trycloudflare.com/pair#token=tok-abc");
      expect(link.hostedUrl).toBe(
        "https://app.codeitlab.com/pair?host=https%3A%2F%2Ffirst-words-here.trycloudflare.com&label=CodeItLab%20Remote#token=tok-abc",
      );
    }),
  );

  it.effect("adds the hosted link for a Tailscale Serve HTTPS base", () =>
    Effect.gen(function* () {
      const remote = service({
        config: config({ host: "127.0.0.1", tailscaleServeEnabled: true }),
      });
      const link = yield* remote.createPairingLink;
      expect(link.hostedUrl).toBe(
        "https://app.codeitlab.com/pair?host=https%3A%2F%2Fstudio-mac.tail1234.ts.net&label=CodeItLab%20Remote#token=tok-abc",
      );
    }),
  );

  it.effect("honours a custom hosted app origin", () =>
    Effect.gen(function* () {
      const { launcher } = fakeTunnel();
      const remote = service({ tunnel: launcher, hostedAppUrl: "https://app.example.com/" });
      yield* remote.manageTunnel({ action: "start" });
      const link = yield* remote.createPairingLink;
      expect(link.hostedUrl).toContain("https://app.example.com/pair?host=");
    }),
  );

  it.effect("refresh stops the tunnel and starts a new one with a new URL", () =>
    Effect.gen(function* () {
      const { launcher, calls } = fakeTunnel();
      const remote = service({ tunnel: launcher });
      const first = yield* remote.manageTunnel({ action: "start" });
      const refreshed = yield* remote.manageTunnel({ action: "refresh" });
      expect(refreshed.tunnel.url).not.toBe(first.tunnel.url);
      expect(refreshed.tunnel.url).toBe("https://second-words-here.trycloudflare.com/");
      expect(calls.start).toHaveLength(2);
      expect(calls.stop).toBe(1);
    }),
  );

  it.effect("start is a no-op while running and stop clears the tunnel", () =>
    Effect.gen(function* () {
      const { launcher, calls } = fakeTunnel();
      const remote = service({ tunnel: launcher });
      const started = yield* remote.manageTunnel({ action: "start" });
      yield* remote.manageTunnel({ action: "start" });
      expect(calls.start).toHaveLength(1);
      const stopped = yield* remote.manageTunnel({ action: "stop" });
      expect(stopped.tunnel.running).toBe(false);
      expect(stopped.tunnel.url).toBeUndefined();
      expect(stopped.server.urls).not.toContain(started.tunnel.url);
      yield* remote.manageTunnel({ action: "stop" });
      expect(calls.stop).toBe(1);
    }),
  );

  it.effect("says the tunnel makes a loopback-only server reachable", () =>
    Effect.gen(function* () {
      const { launcher } = fakeTunnel();
      const remote = service({ config: config({ host: undefined }), tunnel: launcher });
      const started = yield* remote.manageTunnel({ action: "start" });
      expect(started.server.loopbackOnly).toBe(true);
      expect(started.server.urls).toEqual(["https://first-words-here.trycloudflare.com/"]);
      expect(started.detail).toContain("Cloudflare tunnel makes it reachable");
      expect(started.tunnel.detail).toBeUndefined();
    }),
  );

  it.effect("reports an unavailable CLI and refuses to start", () =>
    Effect.gen(function* () {
      const { launcher, calls } = fakeTunnel({
        probe: { available: false, detail: "cloudflared is not installed." },
      });
      const remote = service({ tunnel: launcher });
      const status = yield* remote.status;
      expect(status.tunnel.available).toBe(false);
      expect(status.tunnel.running).toBe(false);
      expect(status.tunnel.detail).toBe("cloudflared is not installed.");
      const failure = yield* remote.manageTunnel({ action: "start" }).pipe(Effect.flip);
      expect(failure.operation).toBe("remote.tunnel");
      expect(failure.message).toContain("cloudflared is not installed.");
      expect(calls.start).toHaveLength(0);
    }),
  );

  it.effect("caches the tunnel probe between status reads", () =>
    Effect.gen(function* () {
      const { launcher, calls } = fakeTunnel();
      const remote = service({ tunnel: launcher });
      yield* remote.status;
      yield* remote.status;
      expect(calls.probe).toBe(1);
    }),
  );

  it.effect("maps a failed start to a CodeItLabServiceError", () =>
    Effect.gen(function* () {
      const { launcher } = fakeTunnel({ startError: new Error("cloudflared exited early.") });
      const remote = service({ tunnel: launcher });
      const failure = yield* remote.manageTunnel({ action: "start" }).pipe(Effect.flip);
      expect(failure.operation).toBe("remote.tunnel");
      expect(failure.message).toBe("cloudflared exited early.");
      const status = yield* remote.status;
      expect(status.tunnel.running).toBe(false);
    }),
  );
});

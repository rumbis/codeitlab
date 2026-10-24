// @effect-diagnostics nodeBuiltinImport:off - the launcher is the Node boundary under test.
import type * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  type CloudflaredSpawn,
  makeCloudflaredLauncher,
  parseCloudflaredVersion,
  parseQuickTunnelUrl,
} from "./cloudflared.ts";

/**
 * The banner cloudflared printed on stderr for a real quick tunnel
 * (captured from cloudflared 2026.10.3 against a local HTTP server).
 */
const REAL_QUICK_TUNNEL_BANNER = [
  "2026-10-23T21:14:43Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out.",
  "2026-10-23T21:14:43Z INF Requesting new quick Tunnel on trycloudflare.com...",
  "2026-10-23T21:14:48Z INF +--------------------------------------------------------------------------------------------+",
  "2026-10-23T21:14:48Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
  "2026-10-23T21:14:48Z INF |  https://ranger-crawford-medicines-forget.trycloudflare.com                                |",
  "2026-10-23T21:14:48Z INF +--------------------------------------------------------------------------------------------+",
  "2026-10-23T21:14:48Z INF Cannot determine default configuration path. No file [config.yml config.yaml] in [~/.cloudflared]",
].join("\n");

const REAL_VERSION_OUTPUT = "cloudflared version 2026.10.3 (built 2026-10-21T10:51:09Z)";

interface FakeChild extends NodeEvents.EventEmitter {
  readonly stdout: NodeEvents.EventEmitter;
  readonly stderr: NodeEvents.EventEmitter;
  readonly pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  readonly kill: ReturnType<typeof vi.fn>;
}

const fakeChild = (): FakeChild => {
  const child = new NodeEvents.EventEmitter() as FakeChild;
  Object.assign(child, {
    stdout: new NodeEvents.EventEmitter(),
    stderr: new NodeEvents.EventEmitter(),
    pid: 4242,
    exitCode: null,
    signalCode: null,
    kill: vi.fn((signal?: NodeJS.Signals) => {
      child.signalCode = signal ?? "SIGTERM";
      return true;
    }),
  });
  return child;
};

/**
 * Runs `script` after the launcher attaches its listeners, so data emitted
 * from the fake child behaves like a real child process.
 */
const fakeSpawn = (script: (child: FakeChild) => void, captured?: { args?: string[] }) => {
  const spawn: CloudflaredSpawn = (command, args) => {
    captured?.args?.push(...args);
    const child = fakeChild();
    queueMicrotask(() => script(child));
    return child as unknown as NodeChildProcess.ChildProcess;
  };
  return spawn;
};

const spawnError = (code: string): Error =>
  Object.assign(new Error(`spawn cloudflared ${code}`), { code });

describe("parseCloudflaredVersion", () => {
  it("reads the version from the real --version output", () => {
    expect(parseCloudflaredVersion(REAL_VERSION_OUTPUT)).toBe("2026.10.3");
  });

  it("finds the version when it is embedded in other output", () => {
    expect(parseCloudflaredVersion(`warn: updating\n${REAL_VERSION_OUTPUT}\n`)).toBe("2026.10.3");
  });

  it("returns null when no version is present", () => {
    expect(parseCloudflaredVersion("")).toBeNull();
    expect(parseCloudflaredVersion("cloudflared: command not found")).toBeNull();
  });
});

describe("parseQuickTunnelUrl", () => {
  it("finds the URL in the real quick tunnel banner", () => {
    expect(parseQuickTunnelUrl(REAL_QUICK_TUNNEL_BANNER)).toBe(
      "https://ranger-crawford-medicines-forget.trycloudflare.com/",
    );
  });

  it("matches case-insensitively and normalises the host", () => {
    expect(parseQuickTunnelUrl("INF | HTTPS://Ranger-Crawford.TryCloudflare.COM |")).toBe(
      "https://ranger-crawford.trycloudflare.com/",
    );
  });

  it("returns null for a named tunnel hostname", () => {
    expect(parseQuickTunnelUrl("INF | https://codeitlab.example.com |")).toBeNull();
  });

  it("returns null before the banner appears", () => {
    expect(
      parseQuickTunnelUrl("INF Requesting new quick Tunnel on trycloudflare.com..."),
    ).toBeNull();
  });
});

describe("cloudflared launcher", () => {
  it("reports the CLI version from a successful probe", async () => {
    const launcher = makeCloudflaredLauncher({
      probeTimeoutMs: 1_000,
      spawn: fakeSpawn((child) => {
        child.stdout.emit("data", Buffer.from(`${REAL_VERSION_OUTPUT}\n`));
        child.emit("close", 0);
      }),
    });

    await expect(launcher.probe()).resolves.toEqual({
      available: true,
      version: "2026.10.3",
    });
  });

  it("turns a missing binary into an install hint", async () => {
    const launcher = makeCloudflaredLauncher({
      probeTimeoutMs: 1_000,
      spawn: fakeSpawn((child) => {
        child.emit("error", spawnError("ENOENT"));
      }),
    });

    const probe = await launcher.probe();
    expect(probe.available).toBe(false);
    expect(probe.detail).toContain("brew install cloudflared");
    expect(probe.detail).toContain("winget install --id Cloudflare.cloudflared");
  });

  it("degrades honestly when the version probe hangs", async () => {
    const launcher = makeCloudflaredLauncher({
      probeTimeoutMs: 10,
      spawn: fakeSpawn(() => {
        // Never answers.
      }),
    });

    const probe = await launcher.probe();
    expect(probe.available).toBe(false);
    expect(probe.detail).toContain("did not answer");
  });

  it("starts a quick tunnel for loopback and resolves on the banner URL", async () => {
    let child: FakeChild | undefined;
    const captured: { args?: string[] } = { args: [] };
    const launcher = makeCloudflaredLauncher({
      startupTimeoutMs: 1_000,
      killGraceMs: 10,
      spawn: ((command, args) => {
        captured.args?.push(...args);
        const spawned = fakeChild();
        child = spawned;
        queueMicrotask(() => {
          // The URL arrives in pieces, like the CLI's line-buffered stderr.
          spawned.stderr.emit("data", Buffer.from(REAL_QUICK_TUNNEL_BANNER.slice(0, 120)));
          spawned.stderr.emit("data", Buffer.from(REAL_QUICK_TUNNEL_BANNER.slice(120)));
        });
        return spawned as unknown as NodeChildProcess.ChildProcess;
      }) satisfies CloudflaredSpawn,
    });

    const tunnel = await launcher.start({ localPort: 4797 });
    expect(tunnel.url).toBe("https://ranger-crawford-medicines-forget.trycloudflare.com/");
    expect(captured.args).toEqual(["tunnel", "--url", "http://127.0.0.1:4797", "--no-autoupdate"]);

    tunnel.stop();
    expect(child?.kill).toHaveBeenCalledWith("SIGTERM");
    tunnel.stop();
    expect(child?.kill).toHaveBeenCalledTimes(1);
  });

  it("uses an explicit local host when one is given", async () => {
    const captured: { args?: string[] } = { args: [] };
    const launcher = makeCloudflaredLauncher({
      startupTimeoutMs: 1_000,
      killGraceMs: 10,
      spawn: fakeSpawn((child) => {
        child.stderr.emit("data", Buffer.from(REAL_QUICK_TUNNEL_BANNER));
      }, captured),
    });

    const tunnel = await launcher.start({ localPort: 4797, localHost: "192.168.1.20" });
    expect(captured.args).toContain("http://192.168.1.20:4797");
    tunnel.stop();
  });

  it("rejects with the install hint when the binary is missing at start", async () => {
    const launcher = makeCloudflaredLauncher({
      startupTimeoutMs: 1_000,
      spawn: fakeSpawn((child) => {
        child.emit("error", spawnError("ENOENT"));
      }),
    });

    await expect(launcher.start({ localPort: 4797 })).rejects.toThrow(/brew install cloudflared/);
  });

  it("rejects when the tunnel URL never appears", async () => {
    const launcher = makeCloudflaredLauncher({
      startupTimeoutMs: 10,
      killGraceMs: 10,
      spawn: fakeSpawn(() => {
        // Never publishes a URL.
      }),
    });

    await expect(launcher.start({ localPort: 4797 })).rejects.toThrow(
      /did not publish a quick tunnel URL/,
    );
  });

  it("rejects when cloudflared exits before the banner", async () => {
    const launcher = makeCloudflaredLauncher({
      startupTimeoutMs: 1_000,
      spawn: fakeSpawn((child) => {
        child.stderr.emit("data", Buffer.from("ERR failed to connect to the edge\n"));
        child.emit("close", 1);
      }),
    });

    await expect(launcher.start({ localPort: 4797 })).rejects.toThrow(
      /exited before publishing a tunnel URL.*failed to connect to the edge/,
    );
  });
});

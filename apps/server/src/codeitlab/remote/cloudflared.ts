// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
// The cloudflared launcher owns a long-lived child process and deliberately
// stays on Node built-ins: it is an adapter at the edge of the Effect services,
// so it can be unit-tested with a fake spawn and no Effect runtime.
import * as NodeChildProcess from "node:child_process";

/**
 * Managed Cloudflare quick tunnel.
 *
 * `cloudflared tunnel --url <local>` asks Cloudflare for a temporary public
 * HTTPS hostname (`<random-words>.trycloudflare.com`) and forwards it to this
 * machine. That is the one remote path that needs neither a Tailscale account
 * nor a port forward, so the server can offer a phone a secure URL in one click.
 *
 * The CLI prints its banner on stderr and its version on stdout, so both
 * parsers take free text; the launcher scans both streams.
 */

/** cloudflared announces its version as `cloudflared version 2026.10.3 (built ...)`. */
const VERSION_PATTERN = /cloudflared version (\d+\.\d+\.\d+)/i;

/**
 * Quick tunnels always live under `trycloudflare.com`; a named tunnel points at
 * the operator's own hostname, which this build cannot manage or predict.
 */
const QUICK_TUNNEL_PATTERN = /https:\/\/([a-z0-9][a-z0-9-]*)\.trycloudflare\.com\b/i;

/** A quick tunnel is requested over the network, so allow for a slow round trip. */
export const QUICK_TUNNEL_TIMEOUT_MS = 20_000;
const VERSION_PROBE_TIMEOUT_MS = 5_000;
const KILL_GRACE_MS = 3_000;
const OUTPUT_TAIL_CHARS = 400;

export const CLOUDFLARED_INSTALL_HINT =
  "The cloudflared CLI was not found. Install it with `brew install cloudflared` on macOS or `winget install --id Cloudflare.cloudflared` on Windows, then reload.";

export interface CloudflaredProbe {
  /** The CLI answered a version probe. */
  readonly available: boolean;
  /** Version string, when it could be read. */
  readonly version?: string;
  /** Why the probe failed, in user-facing language. */
  readonly detail?: string;
}

export interface CloudflaredStartOptions {
  readonly localPort: number;
  /** Where cloudflared connects; the server is normally reachable on loopback. */
  readonly localHost?: string | undefined;
}

export interface CloudflaredTunnel {
  /** Public HTTPS base URL, always with a trailing slash. */
  readonly url: string;
  readonly stop: () => void;
}

export interface CloudflaredTunnelLauncher {
  readonly probe: () => Promise<CloudflaredProbe>;
  readonly start: (options: CloudflaredStartOptions) => Promise<CloudflaredTunnel>;
}

/** Node's spawn, narrowed to the one shape this module needs (and fakes can copy). */
export type CloudflaredSpawn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly stdio: readonly ["ignore", "pipe", "pipe"] },
) => NodeChildProcess.ChildProcess;

export interface CloudflaredLauncherOptions {
  readonly command?: string | undefined;
  readonly spawn?: CloudflaredSpawn | undefined;
  readonly startupTimeoutMs?: number | undefined;
  readonly probeTimeoutMs?: number | undefined;
  readonly killGraceMs?: number | undefined;
}

export const parseCloudflaredVersion = (output: string): string | null => {
  const match = VERSION_PATTERN.exec(output);
  return match?.[1] ?? null;
};

export const parseQuickTunnelUrl = (text: string): string | null => {
  const match = QUICK_TUNNEL_PATTERN.exec(text);
  const name = match?.[1];
  if (name === undefined) return null;
  return `https://${name.toLowerCase()}.trycloudflare.com/`;
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isMissingCommand = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { readonly code?: unknown }).code === "ENOENT";

const outputTail = (text: string): string => text.trim().slice(-OUTPUT_TAIL_CHARS);

const withOutput = (prefix: string, stderr: string): string => {
  const tail = outputTail(stderr);
  return tail.length === 0 ? prefix : `${prefix} Output: ${tail}`;
};

const formatDuration = (milliseconds: number): string =>
  milliseconds % 1_000 === 0 ? `${milliseconds / 1_000} seconds` : `${milliseconds}ms`;

const spawnError = (cause: unknown): Error =>
  isMissingCommand(cause)
    ? new Error(CLOUDFLARED_INSTALL_HINT)
    : new Error(`cloudflared could not be started: ${errorMessage(cause)}`);

interface VersionProbeOutcome {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly error?: unknown;
}

/**
 * Resolves once `cloudflared --version` exits (or times out); never rejects so
 * the status read can always fall back to a plain "not available".
 */
const runVersionProbe = (
  spawn: CloudflaredSpawn,
  command: string,
  timeoutMs: number,
): Promise<VersionProbeOutcome> =>
  new Promise((resolve) => {
    let child: NodeChildProcess.ChildProcess;
    try {
      child = spawn(command, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (cause) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, error: cause });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (outcome: VersionProbeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      finish({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (cause) => {
      finish({ code: null, stdout, stderr, timedOut: false, error: cause });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr, timedOut: false });
    });
  });

const probeVersion = async (
  spawn: CloudflaredSpawn,
  command: string,
  timeoutMs: number,
): Promise<CloudflaredProbe> => {
  const outcome = await runVersionProbe(spawn, command, timeoutMs);
  if (outcome.error !== undefined) {
    return isMissingCommand(outcome.error)
      ? { available: false, detail: CLOUDFLARED_INSTALL_HINT }
      : {
          available: false,
          detail: `The cloudflared CLI could not be started: ${errorMessage(outcome.error)}`,
        };
  }
  if (outcome.timedOut) {
    return {
      available: false,
      detail: `cloudflared --version did not answer within ${formatDuration(timeoutMs)}.`,
    };
  }
  const version =
    parseCloudflaredVersion(outcome.stdout) ?? parseCloudflaredVersion(outcome.stderr);
  if (version !== null) return { available: true, version };
  if (outcome.code === 0) {
    return {
      available: true,
      detail: "cloudflared answered, but its version could not be read.",
    };
  }
  return {
    available: false,
    detail: withOutput("cloudflared --version failed.", outcome.stderr),
  };
};

/**
 * Starts one quick tunnel and resolves when the banner publishes its URL.
 * Failures kill the child before rejecting, so a missing binary or a refused
 * connection never leaves a half-started process behind.
 */
const startQuickTunnel = (
  spawn: CloudflaredSpawn,
  command: string,
  options: CloudflaredStartOptions,
  startupTimeoutMs: number,
  killGraceMs: number,
): Promise<CloudflaredTunnel> =>
  new Promise((resolve, reject) => {
    const localHost = options.localHost ?? "127.0.0.1";
    const target = `http://${localHost}:${options.localPort}`;

    let child: NodeChildProcess.ChildProcess;
    try {
      child = spawn(command, ["tunnel", "--url", target, "--no-autoupdate"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      reject(spawnError(cause));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let stopped = false;

    const killChild = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const grace = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, killGraceMs);
      grace.unref();
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      process.off("exit", stop);
      killChild();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      reject(error);
    };

    const succeed = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.once("exit", stop);
      resolve({ url, stop });
    };

    const scan = () => {
      const url = parseQuickTunnelUrl(`${stdout}\n${stderr}`);
      if (url !== null) succeed(url);
    };

    const timer = setTimeout(() => {
      fail(
        new Error(
          withOutput(
            `cloudflared did not publish a quick tunnel URL within ${formatDuration(startupTimeoutMs)}.`,
            stderr,
          ),
        ),
      );
    }, startupTimeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      scan();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      scan();
    });
    child.on("error", (cause) => {
      fail(spawnError(cause));
    });
    child.on("close", (code) => {
      fail(
        new Error(
          withOutput(
            `cloudflared exited before publishing a tunnel URL (code ${code ?? "unknown"}).`,
            stderr,
          ),
        ),
      );
    });
  });

export const makeCloudflaredLauncher = (
  options: CloudflaredLauncherOptions = {},
): CloudflaredTunnelLauncher => {
  const command = options.command ?? "cloudflared";
  const spawn: CloudflaredSpawn =
    options.spawn ??
    ((spawnCommand, args) =>
      NodeChildProcess.spawn(spawnCommand, args, { stdio: ["ignore", "pipe", "pipe"] }));
  const startupTimeoutMs = options.startupTimeoutMs ?? QUICK_TUNNEL_TIMEOUT_MS;
  const probeTimeoutMs = options.probeTimeoutMs ?? VERSION_PROBE_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;

  return {
    probe: () => probeVersion(spawn, command, probeTimeoutMs),
    start: (startOptions) =>
      startQuickTunnel(spawn, command, startOptions, startupTimeoutMs, killGraceMs),
  };
};

export const cloudflaredLauncher: CloudflaredTunnelLauncher = makeCloudflaredLauncher();

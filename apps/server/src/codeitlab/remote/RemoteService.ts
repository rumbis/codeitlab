import { CodeitlabServiceError } from "@codeitlab/core";
import {
  CODEITLAB_HOSTED_APP_URL,
  REMOTE_PAIRING_LABEL,
  REMOTE_PAIRING_TTL_MINUTES,
  type CodeitlabRemotePairingLink,
  type CodeitlabRemoteStatus,
  type CodeitlabRemoteTunnelAction,
} from "@codeitlab/core/remote";
import { RemoteService as RemoteServiceTag } from "@codeitlab/core/services";
import { buildTailscaleHttpsBaseUrl, parseTailscaleStatus } from "@t3tools/tailscale";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeOS from "node:os";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../../config.ts";
import { resolveBoundEndpoints } from "../../environment/DirectEndpoints.ts";
import * as ProcessRunner from "../../processRunner.ts";
import { formatHostForUrl, isLoopbackHost, isWildcardHost } from "../../startupAccess.ts";
import {
  type CloudflaredProbe,
  type CloudflaredTunnel,
  type CloudflaredTunnelLauncher,
  cloudflaredLauncher,
} from "./cloudflared.ts";

/**
 * Remote access, tailnet first, with a managed Cloudflare quick tunnel.
 *
 * The server already knows how to mint one-time pairing links and how to find
 * the addresses another device could use; what was missing is one honest view
 * of the three together. This service answers "can my phone reach this machine,
 * and what do I hand it?" without requiring a third-party account, and says so
 * plainly when the answer is "no" (loopback-only bind, no tailnet). The tunnel
 * is the escape hatch: it works behind NAT and terminates HTTPS, which is also
 * what lets the hosted PWA talk to this server.
 */

const TAILSCALE_PROBE_TIMEOUT = "5 seconds";
const TAILSCALE_STATUS_TTL_MS = 30_000;
const TUNNEL_PROBE_TTL_MS = 30_000;

const serviceError = (operation: string, message: string, cause?: unknown) =>
  new CodeitlabServiceError({
    operation,
    message,
    ...(cause === undefined ? {} : { cause }),
  });

const NO_TUNNEL_DETAIL =
  "No Cloudflare tunnel is running. Start one to reach this server from a phone over HTTPS.";

const messageOf = (cause: unknown): string =>
  cause instanceof Error && cause.message.length > 0
    ? cause.message
    : "The Cloudflare tunnel could not be started.";

export interface RemoteServiceDeps {
  readonly config: ServerConfig.ServerConfig["Service"];
  readonly processRunner: ProcessRunner.ProcessRunner["Service"];
  readonly auth: EnvironmentAuth.EnvironmentAuth["Service"];
  /** Overridable for tests; defaults to the host's interfaces. */
  readonly interfaces?: ReturnType<typeof NodeOS.networkInterfaces>;
  /** Overridable for tests; defaults to the real `cloudflared` launcher. */
  readonly tunnel?: CloudflaredTunnelLauncher;
  /** Overridable for tests; defaults to the shipped hosted PWA origin. */
  readonly hostedAppUrl?: string;
}

export const makeRemoteService = (deps: RemoteServiceDeps): RemoteServiceTag["Service"] => {
  let cached:
    | { readonly tailnet: CodeitlabRemoteStatus["tailnet"]; readonly atMs: number }
    | undefined;
  let cachedTunnelProbe: { readonly probe: CloudflaredProbe; readonly atMs: number } | undefined;
  let runningTunnel: CloudflaredTunnel | undefined;
  const tunnelLauncher = deps.tunnel ?? cloudflaredLauncher;
  const hostedAppUrl = (deps.hostedAppUrl ?? CODEITLAB_HOSTED_APP_URL).replace(/\/+$/, "");

  // The status RPC already opens a span; a nested one per cached probe read would be noise.
  // oxlint-disable-next-line t3code/prefer-effect-fn -- cached probe behind the status span
  const readTailnet = (): Effect.Effect<CodeitlabRemoteStatus["tailnet"]> =>
    Effect.gen(function* () {
      const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
      if (cached !== undefined && now - cached.atMs < TAILSCALE_STATUS_TTL_MS) {
        return cached.tailnet;
      }
      const tailnet = yield* Effect.gen(function* () {
        const result = yield* deps.processRunner
          .run({
            command: "tailscale",
            args: ["status", "--json"],
            timeout: TAILSCALE_PROBE_TIMEOUT,
            maxOutputBytes: 512 * 1024,
            outputMode: "truncate",
          })
          .pipe(Effect.option);
        if (result._tag === "None") {
          return {
            available: false,
            running: false,
            detail:
              "The Tailscale CLI did not answer. Install Tailscale (or add it to PATH) and sign in, then reload.",
          } satisfies CodeitlabRemoteStatus["tailnet"];
        }
        const stderr = result.value.stderr.trim();
        if (result.value.code === 127 || /not found|no such file/i.test(stderr)) {
          return {
            available: false,
            running: false,
            detail:
              "The Tailscale CLI was not found on PATH. Install Tailscale (or add it to PATH) and sign in, then reload.",
          } satisfies CodeitlabRemoteStatus["tailnet"];
        }
        if (result.value.code !== 0) {
          return {
            available: true,
            running: false,
            detail:
              stderr.length > 0
                ? `Tailscale is not running: ${stderr.slice(0, 200)}`
                : "Tailscale is installed but not running. Start it and sign in, then reload.",
          } satisfies CodeitlabRemoteStatus["tailnet"];
        }
        const parsed = yield* parseTailscaleStatus(result.value.stdout).pipe(Effect.option);
        if (parsed._tag === "None") {
          return {
            available: true,
            running: false,
            detail: "Tailscale answered with a status this build could not parse.",
          } satisfies CodeitlabRemoteStatus["tailnet"];
        }
        const magicDnsName = parsed.value.magicDnsName ?? undefined;
        const ipv4 = parsed.value.tailnetIpv4Addresses.find((address) => address.includes("."));
        return {
          available: true,
          running: true,
          ...(magicDnsName === undefined
            ? {}
            : { hostname: magicDnsName.split(".")[0], dnsName: magicDnsName }),
          ...(ipv4 === undefined ? {} : { ipv4 }),
        } satisfies CodeitlabRemoteStatus["tailnet"];
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("CodeitLab could not read the tailnet status.", { cause }).pipe(
            Effect.as({
              available: false,
              running: false,
              detail: "Reading the Tailscale status failed.",
            } satisfies CodeitlabRemoteStatus["tailnet"]),
          ),
        ),
      );
      cached = { tailnet, atMs: now };
      return tailnet;
    });

  // Probing spawns the CLI, so the answer is cached for a while; a stopped or
  // running tunnel is in-process state and is always read live.
  const readTunnelProbe: () => Effect.Effect<CloudflaredProbe> = Effect.fn(
    "RemoteService.readTunnelProbe",
  )(function* () {
    const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
    if (cachedTunnelProbe !== undefined && now - cachedTunnelProbe.atMs < TUNNEL_PROBE_TTL_MS) {
      return cachedTunnelProbe.probe;
    }
    const probe = yield* Effect.tryPromise({
      try: () => tunnelLauncher.probe(),
      catch: (cause) => serviceError("remote.tunnel", "Probing the cloudflared CLI failed.", cause),
    }).pipe(
      Effect.orElseSucceed((): CloudflaredProbe => ({
        available: false,
        detail: "Probing the cloudflared CLI failed.",
      })),
    );
    cachedTunnelProbe = { probe, atMs: now };
    return probe;
  });

  const stopTunnel = Effect.gen(function* () {
    const tunnel = runningTunnel;
    runningTunnel = undefined;
    if (tunnel === undefined) return;
    yield* Effect.try({
      try: () => tunnel.stop(),
      catch: (cause) =>
        serviceError("remote.tunnel", "Could not stop the Cloudflare tunnel.", cause),
    });
  });

  const startTunnel: (probe: CloudflaredProbe) => Effect.Effect<void, CodeitlabServiceError> =
    Effect.fn("RemoteService.startTunnel")(function* (probe: CloudflaredProbe) {
      const host = deps.config.host;
      // cloudflared runs on this machine: loopback is the one address a
      // wildcard/loopback bind always accepts, and an explicit bind host is
      // used as-is because loopback may not be listening there.
      const localHost = isWildcardHost(host) || isLoopbackHost(host) ? "127.0.0.1" : host;
      const tunnel = yield* Effect.tryPromise({
        try: () =>
          tunnelLauncher.start({
            localPort: deps.config.port,
            ...(localHost === undefined ? {} : { localHost }),
          }),
        catch: (cause) => serviceError("remote.tunnel", messageOf(cause), cause),
      });
      runningTunnel = tunnel;
      // A successful start proves the CLI is present, even if the cached probe
      // raced with an install; keep the version the probe already learned.
      cachedTunnelProbe = {
        probe: {
          available: true,
          ...(probe.version === undefined ? {} : { version: probe.version }),
        },
        atMs: DateTime.toEpochMillis(DateTime.nowUnsafe()),
      };
    });

  const status: RemoteServiceTag["Service"]["status"] = Effect.gen(function* () {
    const [tailnet, tunnelProbe] = yield* Effect.all([readTailnet(), readTunnelProbe()], {
      concurrency: "unbounded",
    });
    const host = deps.config.host;
    const loopbackOnly = isLoopbackHost(host);
    const endpoints = resolveBoundEndpoints({
      host,
      port: deps.config.port,
      interfaces: deps.interfaces ?? NodeOS.networkInterfaces(),
    });
    const tunnelUrl = runningTunnel?.url;
    const tunnelRunning = tunnelUrl !== undefined;
    // Order matters twice over: the first URL becomes the base of the pairing
    // link. The tunnel wins because it is HTTPS and works from any network;
    // then HTTPS because it is the only secure context (browser crypto needs
    // it); then the tailnet, because a phone is most likely in the same
    // tailnet; then LAN addresses for a device on the same Wi-Fi only.
    const rank = (endpoint: { readonly kind: string; readonly httpBaseUrl: string }): number =>
      endpoint.httpBaseUrl.startsWith("https:") ? 0 : endpoint.kind === "tailnet" ? 1 : 2;
    const reachable = [...endpoints]
      .sort((left, right) => rank(left) - rank(right))
      .map((endpoint) => endpoint.httpBaseUrl);
    const urls = [...new Set(tunnelUrl === undefined ? reachable : [tunnelUrl, ...reachable])];
    // Tailscale Serve terminates HTTPS on the MagicDNS name and forwards to
    // loopback, so it is the one remote URL that works for a loopback-only
    // server. It is only advertised when the operator enabled serve.
    if (deps.config.tailscaleServeEnabled && tailnet.dnsName !== undefined && urls.length === 0) {
      urls.push(
        buildTailscaleHttpsBaseUrl({
          magicDnsName: tailnet.dnsName,
          servePort: deps.config.tailscaleServePort,
        }),
      );
    }
    const tunnelDetail = !tunnelProbe.available
      ? (tunnelProbe.detail ?? "The cloudflared CLI is not available.")
      : tunnelRunning
        ? undefined
        : NO_TUNNEL_DETAIL;
    const detail = loopbackOnly
      ? tunnelRunning
        ? "This server only listens on loopback, but the Cloudflare tunnel makes it reachable from a phone over HTTPS."
        : "This server only listens on loopback, so another device cannot reach it directly. Start it with a tailnet or LAN host (codeitlab serve --host <tailnet-ip>), enable Tailscale Serve, or start a Cloudflare tunnel."
      : urls.length === 0
        ? "No reachable network address was found for this server."
        : undefined;
    return {
      tailnet,
      server: {
        host: host === undefined || host.length === 0 ? "127.0.0.1" : host,
        port: deps.config.port,
        loopbackOnly,
        urls,
      },
      tunnel: {
        available: tunnelProbe.available,
        running: tunnelRunning,
        ...(tunnelUrl === undefined ? {} : { url: tunnelUrl }),
        ...(tunnelProbe.version === undefined ? {} : { version: tunnelProbe.version }),
        ...(tunnelDetail === undefined ? {} : { detail: tunnelDetail }),
      },
      pairingAvailable: true,
      ...(detail === undefined ? {} : { detail }),
    } satisfies CodeitlabRemoteStatus;
  }).pipe(
    Effect.mapError((cause) =>
      serviceError("remote.status", "Could not read the remote access status.", cause),
    ),
  );

  const createPairingLink: RemoteServiceTag["Service"]["createPairingLink"] = Effect.gen(
    function* () {
      const current = yield* status;
      const issued = yield* deps.auth
        .createPairingLink({
          ttl: Duration.minutes(REMOTE_PAIRING_TTL_MINUTES),
          label: REMOTE_PAIRING_LABEL,
        })
        .pipe(
          Effect.mapError((cause) =>
            serviceError("remote.pairing", "Could not mint a pairing link.", cause),
          ),
        );
      const base =
        (current.tunnel.running ? current.tunnel.url : undefined) ??
        current.server.urls[0] ??
        `http://${formatHostForUrl(current.server.host)}:${current.server.port}/`;
      const url = new URL("/pair", base);
      url.searchParams.delete("token");
      url.hash = new URLSearchParams([["token", issued.credential]]).toString();
      const label = issued.label ?? REMOTE_PAIRING_LABEL;
      // The hosted PWA is served over HTTPS, so it can only call back to an
      // HTTPS backend; a plain-HTTP link would be blocked as mixed content.
      const hostedUrl = base.startsWith("https:")
        ? `${hostedAppUrl}/pair?host=${encodeURIComponent(new URL(base).origin)}&label=${encodeURIComponent(label)}#${new URLSearchParams([["token", issued.credential]]).toString()}`
        : undefined;
      return {
        url: url.toString(),
        ...(hostedUrl === undefined ? {} : { hostedUrl }),
        expiresAt: DateTime.formatIso(DateTime.toUtc(issued.expiresAt)),
        label,
        scopes: [...issued.scopes],
      } satisfies CodeitlabRemotePairingLink;
    },
  );

  const manageTunnel: RemoteServiceTag["Service"]["manageTunnel"] = Effect.fn(
    "RemoteService.manageTunnel",
  )(function* (input: { readonly action: CodeitlabRemoteTunnelAction }) {
    const probe = yield* readTunnelProbe();
    if (input.action === "stop") {
      yield* stopTunnel;
    } else {
      if (input.action === "refresh") yield* stopTunnel;
      if (runningTunnel === undefined) {
        if (!probe.available) {
          return yield* serviceError(
            "remote.tunnel",
            probe.detail ?? "The cloudflared CLI is not available. Install it, then try again.",
          );
        }
        yield* startTunnel(probe);
      }
    }
    return yield* status;
  });

  return RemoteServiceTag.of({ status, createPairingLink, manageTunnel });
};

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  return makeRemoteService({ config, processRunner, auth });
});

export const layer = Layer.effect(RemoteServiceTag, make);

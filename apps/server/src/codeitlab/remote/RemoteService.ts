import { CodeitlabServiceError } from "@codeitlab/core";
import {
  REMOTE_PAIRING_LABEL,
  REMOTE_PAIRING_TTL_MINUTES,
  type CodeitlabRemotePairingLink,
  type CodeitlabRemoteStatus,
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
import { formatHostForUrl, isLoopbackHost } from "../../startupAccess.ts";

/**
 * Remote access, tailnet first.
 *
 * The server already knows how to mint one-time pairing links and how to find
 * the addresses another device could use; what was missing is one honest view
 * of the two together. This service answers "can my phone reach this machine,
 * and what do I hand it?" without requiring a third-party account, and says so
 * plainly when the answer is "no" (loopback-only bind, no tailnet).
 */

const TAILSCALE_PROBE_TIMEOUT = "5 seconds";
const TAILSCALE_STATUS_TTL_MS = 30_000;

const serviceError = (operation: string, message: string, cause?: unknown) =>
  new CodeitlabServiceError({
    operation,
    message,
    ...(cause === undefined ? {} : { cause }),
  });

export interface RemoteServiceDeps {
  readonly config: ServerConfig.ServerConfig["Service"];
  readonly processRunner: ProcessRunner.ProcessRunner["Service"];
  readonly auth: EnvironmentAuth.EnvironmentAuth["Service"];
  /** Overridable for tests; defaults to the host's interfaces. */
  readonly interfaces?: ReturnType<typeof NodeOS.networkInterfaces>;
}

export const makeRemoteService = (deps: RemoteServiceDeps): RemoteServiceTag["Service"] => {
  let cached:
    | { readonly tailnet: CodeitlabRemoteStatus["tailnet"]; readonly atMs: number }
    | undefined;

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

  const status: RemoteServiceTag["Service"]["status"] = Effect.gen(function* () {
    const tailnet = yield* readTailnet();
    const host = deps.config.host;
    const loopbackOnly = isLoopbackHost(host);
    const endpoints = resolveBoundEndpoints({
      host,
      port: deps.config.port,
      interfaces: deps.interfaces ?? NodeOS.networkInterfaces(),
    });
    // Order matters twice over: the first URL becomes the base of the pairing
    // link. HTTPS wins because it is the only secure context (browser crypto
    // needs it); then the tailnet, because a phone is most likely in the same
    // tailnet; then LAN addresses for a device on the same Wi-Fi only.
    const rank = (endpoint: { readonly kind: string; readonly httpBaseUrl: string }): number =>
      endpoint.httpBaseUrl.startsWith("https:") ? 0 : endpoint.kind === "tailnet" ? 1 : 2;
    const urls = [...endpoints]
      .sort((left, right) => rank(left) - rank(right))
      .map((endpoint) => endpoint.httpBaseUrl);
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
    const detail = loopbackOnly
      ? "This server only listens on loopback, so another device cannot reach it directly. Start it with a tailnet or LAN host (codeitlab serve --host <tailnet-ip>), or enable Tailscale Serve."
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
        current.server.urls[0] ??
        `http://${formatHostForUrl(current.server.host)}:${current.server.port}/`;
      const url = new URL("/pair", base);
      url.searchParams.delete("token");
      url.hash = new URLSearchParams([["token", issued.credential]]).toString();
      return {
        url: url.toString(),
        expiresAt: DateTime.formatIso(DateTime.toUtc(issued.expiresAt)),
        label: issued.label ?? REMOTE_PAIRING_LABEL,
        scopes: [...issued.scopes],
      } satisfies CodeitlabRemotePairingLink;
    },
  );

  return RemoteServiceTag.of({ status, createPairingLink });
};

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  return makeRemoteService({ config, processRunner, auth });
});

export const layer = Layer.effect(RemoteServiceTag, make);

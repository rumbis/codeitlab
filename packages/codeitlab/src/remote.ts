import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Remote access contracts.
 *
 * CodeItLab prefers the network you already own: a tailnet (or LAN) address plus
 * a one-time pairing link, no third-party account in the path. The upstream
 * relay ("CodeItLab Connect") still exists and is untouched; this surface only makes
 * the direct path visible and one click away, and tells the truth when the
 * server is bound to loopback and a phone therefore cannot reach it.
 */

const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabRemoteTailnet = Schema.Struct({
  /** The Tailscale CLI answered and its status could be parsed. */
  available: BooleanDefault(false),
  /** The tailnet backend is up on this machine. */
  running: BooleanDefault(false),
  /** Short host name reported by the tailnet, when known. */
  hostname: Schema.optional(Schema.String),
  /** MagicDNS name (e.g. `machine.tailnet.ts.net`), when enabled. */
  dnsName: Schema.optional(Schema.String),
  /** First tailnet IPv4 address (100.64.0.0/10). */
  ipv4: Schema.optional(Schema.String),
  /** Why the tailnet is unavailable, in user-facing language. */
  detail: Schema.optional(Schema.String),
});
export type CodeItLabRemoteTailnet = typeof CodeItLabRemoteTailnet.Type;

export const CodeItLabRemoteTunnel = Schema.Struct({
  /** The `cloudflared` CLI answered a version probe. */
  available: BooleanDefault(false),
  /** A managed quick tunnel is running for this server. */
  running: BooleanDefault(false),
  /** Public HTTPS base URL the tunnel points at, e.g. `https://x.trycloudflare.com/`. */
  url: Schema.optional(Schema.String),
  /** Version string reported by `cloudflared --version`. */
  version: Schema.optional(Schema.String),
  /** Why the tunnel is unavailable or stopped, in user-facing language. */
  detail: Schema.optional(Schema.String),
});
export type CodeItLabRemoteTunnel = typeof CodeItLabRemoteTunnel.Type;

export const CodeItLabRemoteTunnelAction = Schema.Literals(["start", "stop", "refresh"]);
export type CodeItLabRemoteTunnelAction = typeof CodeItLabRemoteTunnelAction.Type;

export const CodeItLabRemoteServer = Schema.Struct({
  /** The configured listen host (`0.0.0.0`, `127.0.0.1`, a tailnet IP, ...). */
  host: Schema.String,
  port: Schema.Number,
  /** True when the server only accepts loopback connections. */
  loopbackOnly: BooleanDefault(false),
  /** Base URLs another device could use to reach this server. */
  urls: Schema.Array(Schema.String),
});
export type CodeItLabRemoteServer = typeof CodeItLabRemoteServer.Type;

export const CodeItLabRemoteStatus = Schema.Struct({
  tailnet: CodeItLabRemoteTailnet,
  server: CodeItLabRemoteServer,
  tunnel: CodeItLabRemoteTunnel,
  /** Pairing links can be minted in this process. */
  pairingAvailable: BooleanDefault(true),
  detail: Schema.optional(Schema.String),
});
export type CodeItLabRemoteStatus = typeof CodeItLabRemoteStatus.Type;

export const CodeItLabRemotePairingLink = Schema.Struct({
  /** Ready-to-scan link: `<base>/pair#token=<credential>`. */
  url: Schema.String,
  /**
   * Same credential, addressed to the hosted PWA (`app.codeitlab.com/pair`).
   * Present only when a public HTTPS base URL exists, because the hosted app
   * cannot talk to a plain-HTTP backend from its HTTPS origin.
   */
  hostedUrl: Schema.optional(Schema.String),
  /** ISO timestamp after which the link stops working. */
  expiresAt: Schema.String,
  label: Schema.String,
  scopes: Schema.Array(Schema.String),
});
export type CodeItLabRemotePairingLink = typeof CodeItLabRemotePairingLink.Type;

/** The hosted CodeItLab PWA that can pair with any reachable HTTPS backend. */
export const DEFAULT_HOSTED_APP_URL = "https://app.codeitlab.com";

/** Default lifetime for a phone pairing link. */
export const REMOTE_PAIRING_TTL_MINUTES = 30;

export const REMOTE_PAIRING_LABEL = "CodeItLab Remote";

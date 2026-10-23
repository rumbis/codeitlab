import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Remote access contracts.
 *
 * CodeitLab prefers the network you already own: a tailnet (or LAN) address plus
 * a one-time pairing link, no third-party account in the path. The upstream
 * relay ("CodeitLab Connect") still exists and is untouched; this surface only makes
 * the direct path visible and one click away, and tells the truth when the
 * server is bound to loopback and a phone therefore cannot reach it.
 */

const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeitlabRemoteTailnet = Schema.Struct({
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
export type CodeitlabRemoteTailnet = typeof CodeitlabRemoteTailnet.Type;

export const CodeitlabRemoteServer = Schema.Struct({
  /** The configured listen host (`0.0.0.0`, `127.0.0.1`, a tailnet IP, ...). */
  host: Schema.String,
  port: Schema.Number,
  /** True when the server only accepts loopback connections. */
  loopbackOnly: BooleanDefault(false),
  /** Base URLs another device could use to reach this server. */
  urls: Schema.Array(Schema.String),
});
export type CodeitlabRemoteServer = typeof CodeitlabRemoteServer.Type;

export const CodeitlabRemoteStatus = Schema.Struct({
  tailnet: CodeitlabRemoteTailnet,
  server: CodeitlabRemoteServer,
  /** Pairing links can be minted in this process. */
  pairingAvailable: BooleanDefault(true),
  detail: Schema.optional(Schema.String),
});
export type CodeitlabRemoteStatus = typeof CodeitlabRemoteStatus.Type;

export const CodeitlabRemotePairingLink = Schema.Struct({
  /** Ready-to-scan link: `<base>/pair#token=<credential>`. */
  url: Schema.String,
  /** ISO timestamp after which the link stops working. */
  expiresAt: Schema.String,
  label: Schema.String,
  scopes: Schema.Array(Schema.String),
});
export type CodeitlabRemotePairingLink = typeof CodeitlabRemotePairingLink.Type;

/** Default lifetime for a phone pairing link. */
export const REMOTE_PAIRING_TTL_MINUTES = 30;

export const REMOTE_PAIRING_LABEL = "CodeitLab Remote";

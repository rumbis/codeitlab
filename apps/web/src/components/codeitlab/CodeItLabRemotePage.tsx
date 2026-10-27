import { useState } from "react";
import {
  CheckIcon,
  CloudIcon,
  CopyIcon,
  Link2Icon,
  PlayIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  SquareIcon,
  WifiIcon,
} from "lucide-react";

import type { CodeItLabRemotePairingLink, CodeItLabRemoteTunnelAction } from "@codeitlab/contracts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { QRCodeSvg } from "../ui/qr-code";
import { playCodeItLabSfx, unlockCodeItLabAudio } from "../../codeitlab/audio";
import { useCodeItLabRemote } from "../../codeitlab/api";
import {
  cloudflaredInstallCommand,
  cloudflaredPlatform,
  CLOUDFLARED_DOWNLOAD_URL,
  hostedPairingHint,
  pairingLinkTargets,
  remoteTunnelBadges,
  tunnelPublicUrl,
} from "../../codeitlab/remoteTunnel";
import {
  CodeItLabCard,
  CodeItLabLoadingRows,
  CodeItLabSectionHeading,
  CodeItLabSourceNote,
} from "./CodeItLabPrimitives";

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailRow({
  label,
  value,
  mono = true,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border/50 px-4 py-2.5 first:border-t-0">
      <span className="codeitlab-mono-label text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs text-foreground" : "text-xs text-foreground"}>
        {value}
      </span>
    </div>
  );
}

export function CodeItLabRemotePage() {
  const remote = useCodeItLabRemote();
  const [link, setLink] = useState<CodeItLabRemotePairingLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState<CodeItLabRemoteTunnelAction | null>(null);
  const [tunnelError, setTunnelError] = useState<string | null>(null);

  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    playCodeItLabSfx("click");
  };

  const createPhoneLink = async () => {
    unlockCodeItLabAudio();
    setCreating(true);
    setLinkError(null);
    try {
      const result = await remote.createPairingLink();
      if (result === null) {
        setLinkError("This server cannot mint pairing links yet (no environment connected).");
      } else {
        setLink(result);
        playCodeItLabSfx("success");
      }
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : "Could not create a phone link.");
      playCodeItLabSfx("error");
    }
    setCreating(false);
  };

  const manageTunnel = async (action: CodeItLabRemoteTunnelAction) => {
    unlockCodeItLabAudio();
    setTunnelBusy(action);
    setTunnelError(null);
    try {
      const result = await remote.manageTunnel(action);
      if (result === null) {
        setTunnelError("Connect an environment to manage the Cloudflare tunnel.");
        playCodeItLabSfx("error");
      } else {
        playCodeItLabSfx("success");
      }
    } catch (cause) {
      setTunnelError(
        cause instanceof Error ? cause.message : "The Cloudflare tunnel action failed.",
      );
      playCodeItLabSfx("error");
    }
    setTunnelBusy(null);
  };

  const tailnet = remote.data.tailnet;
  const server = remote.data.server;
  const tunnel = remote.data.tunnel;
  const tunnelBadges = remoteTunnelBadges(tunnel);
  const tunnelUrl = tunnelPublicUrl(tunnel);
  const platform = cloudflaredPlatform(typeof navigator === "undefined" ? "" : navigator.userAgent);
  const installCommand = cloudflaredInstallCommand(platform);
  const pairingTargets = link === null ? null : pairingLinkTargets(link);
  const pairingHint = link === null ? null : hostedPairingHint({ link, tunnel });
  const serverAddress = `${server.host}:${server.port}`;
  const tailnetTone = tailnet.running ? "success" : tailnet.available ? "warning" : "outline";

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="remote">
      <CodeItLabSourceNote source={remote.source} />

      <CodeItLabSectionHeading
        eyebrow="REMOTE // TAILNET, TUNNEL & PAIRING"
        title="Remote access"
        description="Reach this CodeItLab server from your phone on the network you already own, or open a temporary Cloudflare Tunnel when you cannot share a network. No account is needed on either path: join a tailnet or start the tunnel, then scan a one-time link."
        action={
          <Button
            aria-describedby="remote-status-state"
            size="sm"
            variant="outline"
            disabled={remote.isPending}
            onClick={() => remote.refresh()}
            data-remote-retry
          >
            <RefreshCwIcon className="size-3.5" />
            Refresh status
          </Button>
        }
      />

      <p aria-live="polite" className="text-2xs text-muted-foreground" id="remote-status-state">
        {remote.isPending
          ? "Reading remote status…"
          : "Status comes from the last read; Refresh asks the server again."}
      </p>

      {remote.error === null ? null : (
        <Alert variant="error" data-remote-error>
          <AlertTitle>Remote status unavailable</AlertTitle>
          <AlertDescription>
            <p>{remote.error}</p>
            <p className="mt-1 text-xs">
              The direct path is unchanged on disk; retry once the server is reachable. The
              CodeItLab Connect relay under Settings → Connections still works as before.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {remote.isPending && remote.source === "local" ? (
        <CodeItLabLoadingRows label="Loading remote status" rows={2} />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <CodeItLabCard data-remote-tailnet>
              <div className="flex items-center justify-between gap-2 px-4 pt-4">
                <div className="flex items-center gap-2">
                  <WifiIcon className="size-4 text-codeitlab-green" />
                  <h3 className="font-display text-sm font-semibold text-foreground">Tailnet</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge size="sm" variant={tailnet.available ? "outline" : "secondary"}>
                    {tailnet.available ? "Tailscale detected" : "No Tailscale"}
                  </Badge>
                  <Badge size="sm" variant={tailnetTone}>
                    {tailnet.running ? "running" : tailnet.available ? "stopped" : "unavailable"}
                  </Badge>
                </div>
              </div>
              <div className="mt-3">
                <DetailRow label="MagicDNS" value={tailnet.dnsName ?? "not enabled"} />
                <DetailRow label="Host" value={tailnet.hostname ?? "unknown"} />
                <DetailRow label="Tailnet IPv4" value={tailnet.ipv4 ?? "not assigned"} />
                <DetailRow
                  label="Pairing"
                  value={remote.data.pairingAvailable ? "available" : "unavailable"}
                />
              </div>
              {tailnet.running ? null : (
                <p
                  className="mx-4 mb-4 mt-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning-foreground"
                  data-remote-tailnet-hint
                >
                  Install or start Tailscale on this machine, sign in to your tailnet, then reload
                  this page. {tailnet.detail === undefined ? null : <span>{tailnet.detail}</span>}
                </p>
              )}
              {tailnet.running && tailnet.detail !== undefined ? (
                <p className="mx-4 mb-4 mt-3 text-xs text-muted-foreground">{tailnet.detail}</p>
              ) : null}
            </CodeItLabCard>

            <CodeItLabCard data-remote-server>
              <div className="flex items-center justify-between gap-2 px-4 pt-4">
                <div className="flex items-center gap-2">
                  <Link2Icon className="size-4 text-codeitlab-green" />
                  <h3 className="font-display text-sm font-semibold text-foreground">Server</h3>
                </div>
                <Badge size="sm" variant={server.loopbackOnly ? "warning" : "success"}>
                  {server.loopbackOnly ? "loopback only" : "reachable"}
                </Badge>
              </div>
              <div className="mt-3">
                <DetailRow label="Listen" value={serverAddress} />
                <DetailRow label="Host" value={server.host} />
                <DetailRow label="Port" value={String(server.port)} />
              </div>
              {server.loopbackOnly ? (
                <Alert variant="warning" className="mx-4 mb-4 mt-3" data-remote-loopback-warning>
                  <AlertTitle>Phones cannot reach this server</AlertTitle>
                  <AlertDescription>
                    This server only listens on 127.0.0.1 — restart it with a tailnet/LAN host (for
                    example 0.0.0.0) so devices on your tailnet can connect, or use CodeItLab
                    Connect.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CodeItLabCard>

            <CodeItLabCard className="lg:col-span-2" data-remote-tunnel>
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
                <div className="flex items-start gap-2">
                  <CloudIcon className="mt-0.5 size-4 text-codeitlab-green" />
                  <div>
                    <h3 className="font-display text-sm font-semibold text-foreground">
                      Cloudflare Tunnel
                    </h3>
                    <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                      Managed <code className="font-mono">cloudflared</code> quick tunnel: a
                      temporary public HTTPS URL for this server, with no account in the path.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tunnelBadges.map((badge) => (
                    <Badge key={badge.id} size="sm" variant={badge.tone}>
                      {badge.label}
                    </Badge>
                  ))}
                </div>
              </div>

              {tunnelError === null ? null : (
                <Alert variant="error" className="mx-4 mb-3 mt-3" data-remote-tunnel-error>
                  <AlertTitle>Cloudflare tunnel action failed</AlertTitle>
                  <AlertDescription>{tunnelError}</AlertDescription>
                </Alert>
              )}

              {tunnel.available ? (
                <>
                  {tunnelUrl === null ? (
                    <p
                      className="mx-4 mb-3 mt-3 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning-foreground"
                      data-remote-tunnel-note
                    >
                      Starting the tunnel exposes this server publicly over HTTPS while it runs.
                      Quick tunnel URLs are temporary and change when you refresh them.
                    </p>
                  ) : (
                    <div
                      className="mx-4 mb-3 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-codeitlab-green/30 bg-codeitlab-green/8 px-3 py-2"
                      data-remote-tunnel-url={tunnelUrl}
                    >
                      <code className="min-w-0 break-all font-mono text-xs text-foreground">
                        {tunnelUrl}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void copy("tunnel-url", tunnelUrl)}
                        aria-label={`Copy ${tunnelUrl}`}
                      >
                        {copied === "tunnel-url" ? (
                          <CheckIcon className="size-3.5" />
                        ) : (
                          <CopyIcon className="size-3.5" />
                        )}
                        {copied === "tunnel-url" ? "Copied" : "Copy URL"}
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-4 py-3">
                    <Button
                      aria-describedby="remote-tunnel-state"
                      size="sm"
                      variant={tunnel.running ? "outline" : "default"}
                      disabled={tunnelBusy !== null || tunnel.running}
                      onClick={() => void manageTunnel("start")}
                      data-remote-tunnel-start
                    >
                      <PlayIcon className="size-3.5" />
                      {tunnelBusy === "start" ? "Starting…" : "Start tunnel"}
                    </Button>
                    <Button
                      aria-describedby="remote-tunnel-state"
                      size="sm"
                      variant="outline"
                      disabled={tunnelBusy !== null || !tunnel.running}
                      onClick={() => void manageTunnel("stop")}
                      data-remote-tunnel-stop
                    >
                      <SquareIcon className="size-3.5" />
                      {tunnelBusy === "stop" ? "Stopping…" : "Stop"}
                    </Button>
                    <Button
                      aria-describedby="remote-tunnel-state"
                      size="sm"
                      variant="outline"
                      disabled={tunnelBusy !== null || !tunnel.running}
                      onClick={() => void manageTunnel("refresh")}
                      data-remote-tunnel-refresh
                    >
                      <RefreshCwIcon className="size-3.5" />
                      {tunnelBusy === "refresh" ? "Refreshing…" : "Refresh URL"}
                    </Button>
                    <span
                      aria-live="polite"
                      className="text-2xs text-muted-foreground"
                      id="remote-tunnel-state"
                    >
                      {tunnelBusy !== null
                        ? `${tunnelBusy === "start" ? "Starting" : tunnelBusy === "stop" ? "Stopping" : "Refreshing"} the tunnel…`
                        : tunnel.running
                          ? "The tunnel is running. Stop closes it; Refresh URL starts a new quick tunnel with a new URL."
                          : "The tunnel is stopped. Start opens a temporary public HTTPS URL for this server."}
                    </span>
                  </div>
                  {tunnel.detail === undefined ? null : (
                    <p className="mx-4 mb-4 text-xs text-muted-foreground">{tunnel.detail}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="mx-4 mb-3 mt-3 text-xs text-muted-foreground">
                    <code className="font-mono">cloudflared</code> was not found on the machine
                    running this server. The CLI is required to open a public HTTPS URL; install it
                    there, then refresh status.
                  </p>
                  {installCommand === null ? (
                    <p className="mx-4 mb-4 text-xs text-muted-foreground">
                      {platform === "mobile"
                        ? "This page is open on a phone — install cloudflared on the machine running the server from the "
                        : "Install it from the "}
                      <a
                        className="underline underline-offset-2"
                        href={CLOUDFLARED_DOWNLOAD_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Cloudflare downloads page
                      </a>
                      , then refresh status.
                    </p>
                  ) : (
                    <div
                      className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
                      data-remote-tunnel-install
                    >
                      <code className="min-w-0 break-all font-mono text-xs text-foreground">
                        {installCommand}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void copy("install", installCommand)}
                        aria-label={`Copy ${installCommand}`}
                      >
                        {copied === "install" ? (
                          <CheckIcon className="size-3.5" />
                        ) : (
                          <CopyIcon className="size-3.5" />
                        )}
                        {copied === "install" ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  )}
                  {tunnel.detail === undefined ? null : (
                    <p className="mx-4 mb-4 text-xs text-muted-foreground">{tunnel.detail}</p>
                  )}
                </>
              )}
            </CodeItLabCard>
          </div>

          <CodeItLabCard data-remote-urls>
            <div className="flex items-center justify-between gap-2 px-4 pt-4">
              <div>
                <h3 className="font-display text-sm font-semibold text-foreground">
                  Reachable URLs
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Open one of these from a browser on another device, or paste it into the CodeItLab
                  mobile app.
                </p>
              </div>
              <Badge size="sm" variant="outline">
                {server.urls.length}
              </Badge>
            </div>
            {server.urls.length === 0 ? (
              <p className="mx-4 mb-4 mt-3 text-xs text-muted-foreground" data-remote-urls-empty>
                No reachable URLs. The server is bound to loopback, so only this machine can connect
                until it is restarted on a tailnet/LAN address.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col">
                {server.urls.map((url, index) => (
                  <li
                    key={url}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5 first:border-t-0"
                    data-remote-url={url}
                  >
                    <code className="min-w-0 break-all font-mono text-xs text-foreground">
                      {url}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copy(`url:${index}`, url)}
                      aria-label={`Copy ${url}`}
                    >
                      {copied === `url:${index}` ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        <CopyIcon className="size-3.5" />
                      )}
                      {copied === `url:${index}` ? "Copied" : "Copy"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CodeItLabCard>

          <CodeItLabCard data-remote-pairing>
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
              <div className="flex items-start gap-2">
                <SmartphoneIcon className="mt-0.5 size-4 text-codeitlab-green" />
                <div>
                  <h3 className="font-display text-sm font-semibold text-foreground">
                    Create phone link
                  </h3>
                  <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                    Mints a one-time pairing link on this server. The PWA link opens the hosted app
                    so your phone can install it; the direct link works with the native app or a
                    browser on this network. Links expire; create a new one when they do.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                aria-describedby={
                  remote.data.pairingAvailable
                    ? "remote-pairing-state"
                    : "remote-pairing-unavailable remote-pairing-state"
                }
                disabled={creating || !remote.data.pairingAvailable}
                onClick={() => void createPhoneLink()}
                data-remote-create-link
              >
                <SmartphoneIcon className="size-3.5" />
                {creating ? "Creating…" : "Create phone link"}
              </Button>
            </div>

            {remote.data.pairingAvailable ? null : (
              <p
                className="mx-4 mb-4 mt-3 rounded-lg border border-border/70 px-3 py-2 text-xs text-muted-foreground"
                id="remote-pairing-unavailable"
              >
                Pairing is disabled on this server, so this button stays disabled. Use CodeItLab
                Connect under Settings → Connections instead.
              </p>
            )}

            <p
              aria-live="polite"
              className="mx-4 mb-4 text-2xs text-muted-foreground"
              id="remote-pairing-state"
            >
              {creating
                ? "Minting a one-time link on this server…"
                : link === null
                  ? "No link has been minted yet; links expire, so create one when you need it."
                  : "A link was minted above; links expire, so create a new one when it does."}
            </p>

            {linkError === null ? null : (
              <Alert variant="error" className="mx-4 mb-4 mt-3" data-remote-link-error>
                <AlertTitle>Could not create a phone link</AlertTitle>
                <AlertDescription>{linkError}</AlertDescription>
              </Alert>
            )}

            {link === null || pairingTargets === null ? (
              <p className="mx-4 mb-4 mt-3 text-xs text-muted-foreground">
                {remote.data.pairingAvailable
                  ? "No phone link yet. Create one to show the QR code."
                  : "This server has pairing disabled, so no link can be minted here. Use CodeItLab Connect under Settings → Connections instead."}
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-4 border-t border-border/50 px-4 pb-4 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="sm" variant="success">
                    {link.label}
                  </Badge>
                  <Badge size="sm" variant="outline">
                    expires {formatExpiry(link.expiresAt)}
                  </Badge>
                  {link.scopes.map((scope) => (
                    <Badge key={scope} size="sm" variant="secondary">
                      {scope}
                    </Badge>
                  ))}
                </div>

                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className="shrink-0 rounded-xl bg-white p-3 shadow-xs/5" data-remote-qr>
                    <QRCodeSvg
                      value={pairingTargets.primary.url}
                      size={176}
                      level="M"
                      marginSize={2}
                      title={
                        pairingTargets.primary.kind === "hosted"
                          ? "CodeItLab PWA pairing QR code"
                          : "CodeItLab phone pairing QR code"
                      }
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div>
                      <p className="font-display text-sm font-medium text-foreground">
                        {pairingTargets.primary.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {pairingTargets.primary.description}
                      </p>
                    </div>
                    <code
                      className="break-all font-mono text-xs text-foreground"
                      data-remote-pairing-url
                      data-remote-pairing-kind={pairingTargets.primary.kind}
                    >
                      {pairingTargets.primary.url}
                    </code>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void copy("pairing-primary", pairingTargets.primary.url)}
                        data-remote-copy-link
                      >
                        {copied === "pairing-primary" ? (
                          <CheckIcon className="size-3.5" />
                        ) : (
                          <CopyIcon className="size-3.5" />
                        )}
                        {copied === "pairing-primary"
                          ? "Copied"
                          : pairingTargets.primary.kind === "hosted"
                            ? "Copy PWA link"
                            : "Copy link"}
                      </Button>
                      <span className="text-2xs text-muted-foreground">
                        {pairingTargets.primary.kind === "hosted"
                          ? "Scan or open on your phone to install the app"
                          : "Scan with the CodeItLab mobile app → Add environment"}
                      </span>
                    </div>
                  </div>
                </div>

                {pairingTargets.secondary === null ? null : (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3"
                    data-remote-direct-link
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">
                        {pairingTargets.secondary.title} · {pairingTargets.secondary.description}
                      </p>
                      <code className="break-all font-mono text-2xs text-muted-foreground">
                        {pairingTargets.secondary.url}
                      </code>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void copy("pairing-direct", pairingTargets.secondary?.url ?? "")
                      }
                      aria-label="Copy direct pairing link"
                    >
                      {copied === "pairing-direct" ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        <CopyIcon className="size-3.5" />
                      )}
                      {copied === "pairing-direct" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                )}

                {pairingHint === null ? null : (
                  <p className="text-xs text-muted-foreground" data-remote-pwa-hint>
                    {pairingHint}
                  </p>
                )}
              </div>
            )}
          </CodeItLabCard>

          <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Direct path needs no account.</span>{" "}
              Pairing over your tailnet, LAN, or the Cloudflare quick tunnel talks straight to this
              server. The existing{" "}
              <span className="font-medium text-foreground">
                Settings → Connections → CodeItLab Connect
              </span>{" "}
              path uses the upstream relay/account and is unchanged; use it when you cannot join the
              same network.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

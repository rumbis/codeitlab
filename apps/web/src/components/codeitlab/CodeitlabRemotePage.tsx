import { useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  Link2Icon,
  RefreshCwIcon,
  SmartphoneIcon,
  WifiIcon,
} from "lucide-react";

import type { CodeitlabRemotePairingLink } from "@t3tools/contracts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { QRCodeSvg } from "../ui/qr-code";
import { playCodeitlabSfx, unlockCodeitlabAudio } from "../../codeitlab/audio";
import { useCodeitlabRemote } from "../../codeitlab/api";
import {
  CodeitlabCard,
  CodeitlabLoadingRows,
  CodeitlabSectionHeading,
  CodeitlabSourceNote,
} from "./CodeitlabPrimitives";

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

export function CodeitlabRemotePage() {
  const remote = useCodeitlabRemote();
  const [link, setLink] = useState<CodeitlabRemotePairingLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    playCodeitlabSfx("click");
  };

  const createPhoneLink = async () => {
    unlockCodeitlabAudio();
    setCreating(true);
    setLinkError(null);
    try {
      const result = await remote.createPairingLink();
      if (result === null) {
        setLinkError("This server cannot mint pairing links yet (no environment connected).");
      } else {
        setLink(result);
        playCodeitlabSfx("success");
      }
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : "Could not create a phone link.");
      playCodeitlabSfx("error");
    }
    setCreating(false);
  };

  const tailnet = remote.data.tailnet;
  const server = remote.data.server;
  const serverAddress = `${server.host}:${server.port}`;
  const tailnetTone = tailnet.running ? "success" : tailnet.available ? "warning" : "outline";

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="remote">
      <CodeitlabSourceNote source={remote.source} />

      <CodeitlabSectionHeading
        eyebrow="REMOTE // TAILNET & PAIRING"
        title="Remote access"
        description="Reach this CodeitLab server from your phone on the network you already own. No account is needed on the direct path: join a tailnet, bind the server to a reachable address, then scan a one-time link."
        action={
          <Button size="sm" variant="outline" onClick={() => remote.refresh()} data-remote-retry>
            <RefreshCwIcon className="size-3.5" />
            Refresh status
          </Button>
        }
      />

      {remote.error === null ? null : (
        <Alert variant="error" data-remote-error>
          <AlertTitle>Remote status unavailable</AlertTitle>
          <AlertDescription>
            <p>{remote.error}</p>
            <p className="mt-1 text-xs">
              The direct path is unchanged on disk; retry once the server is reachable. The
              CodeitLab Connect relay under Settings → Connections still works as before.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {remote.isPending && remote.source === "local" ? (
        <CodeitlabLoadingRows rows={2} />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <CodeitlabCard data-remote-tailnet>
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
            </CodeitlabCard>

            <CodeitlabCard data-remote-server>
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
                    example 0.0.0.0) so devices on your tailnet can connect, or use CodeitLab
                    Connect.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CodeitlabCard>
          </div>

          <CodeitlabCard data-remote-urls>
            <div className="flex items-center justify-between gap-2 px-4 pt-4">
              <div>
                <h3 className="font-display text-sm font-semibold text-foreground">
                  Reachable URLs
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Open one of these from a browser on another device, or paste it into the CodeitLab
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
          </CodeitlabCard>

          <CodeitlabCard data-remote-pairing>
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
              <div className="flex items-start gap-2">
                <SmartphoneIcon className="mt-0.5 size-4 text-codeitlab-green" />
                <div>
                  <h3 className="font-display text-sm font-semibold text-foreground">
                    Create phone link
                  </h3>
                  <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                    Mints a one-time pairing link on this server. Scan it with the CodeitLab mobile
                    app → Add environment. The link expires; create a new one when it does.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={creating || !remote.data.pairingAvailable}
                onClick={() => void createPhoneLink()}
                data-remote-create-link
              >
                <SmartphoneIcon className="size-3.5" />
                {creating ? "Creating…" : "Create phone link"}
              </Button>
            </div>

            {linkError === null ? null : (
              <Alert variant="error" className="mx-4 mb-4 mt-3" data-remote-link-error>
                <AlertTitle>Could not create a phone link</AlertTitle>
                <AlertDescription>{linkError}</AlertDescription>
              </Alert>
            )}

            {link === null ? (
              <p className="mx-4 mb-4 mt-3 text-xs text-muted-foreground">
                {remote.data.pairingAvailable
                  ? "No phone link yet. Create one to show the QR code."
                  : "This server has pairing disabled, so no link can be minted here. Use CodeitLab Connect under Settings → Connections instead."}
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-4 border-t border-border/50 px-4 pb-4 pt-4 sm:flex-row">
                <div className="shrink-0 rounded-xl bg-white p-3 shadow-xs/5" data-remote-qr>
                  <QRCodeSvg
                    value={link.url}
                    size={176}
                    level="M"
                    marginSize={2}
                    title="CodeitLab phone pairing QR code"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-2">
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
                  <code
                    className="break-all font-mono text-xs text-foreground"
                    data-remote-pairing-url
                  >
                    {link.url}
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copy("pairing", link.url)}
                      data-remote-copy-link
                    >
                      {copied === "pairing" ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        <CopyIcon className="size-3.5" />
                      )}
                      {copied === "pairing" ? "Copied" : "Copy link"}
                    </Button>
                    <span className="text-2xs text-muted-foreground">
                      Scan with the CodeitLab mobile app → Add environment
                    </span>
                  </div>
                </div>
              </div>
            )}
          </CodeitlabCard>

          <div className="rounded-xl border border-border/60 bg-background/40 px-4 py-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Direct path needs no account.</span>{" "}
              Pairing over your tailnet or LAN talks straight to this server. The existing{" "}
              <span className="font-medium text-foreground">
                Settings → Connections → CodeitLab Connect
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

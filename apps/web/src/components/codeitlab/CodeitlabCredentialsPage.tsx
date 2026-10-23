import { useState } from "react";
import {
  DownloadIcon,
  KeyRoundIcon,
  PlayIcon,
  RefreshCwIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SquareIcon,
} from "lucide-react";

import type {
  CodeitlabCredentialsFindingKind,
  CodeitlabCredentialsMode,
  CodeitlabCredentialsScanResult,
  CodeitlabCredentialsSettings,
} from "@t3tools/contracts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { useCodeitlabCredentials } from "../../codeitlab/api";
import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import { playCodeitlabSfx, unlockCodeitlabAudio } from "../../codeitlab/audio";
import {
  CodeitlabCard,
  CodeitlabLoadingRows,
  CodeitlabSectionHeading,
  CodeitlabSourceNote,
} from "./CodeitlabPrimitives";

const MODES: ReadonlyArray<{ value: CodeitlabCredentialsMode; label: string }> = [
  { value: "secrets", label: "Secrets only — keys, passwords, tokens" },
  { value: "balanced", label: "Balanced — secrets plus personal data" },
  { value: "max", label: "Maximum — also private IPs and network details" },
];

const FINDING_LABELS: Record<CodeitlabCredentialsFindingKind, string> = {
  "api-key": "API key",
  password: "Password",
  token: "Token",
  "private-key": "Private key",
  jwt: "JWT",
  "connection-string": "Connection string",
  email: "Email",
  phone: "Phone",
  iban: "IBAN",
  card: "Card",
  ip: "Private IP",
  "private-block": "/private block",
  "model-detected": "Local model",
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function CodeitlabCredentialsPage() {
  const credentials = useCodeitlabCredentials();
  const { codeitlab } = useCodeitlabSettingsWriter();
  const [draft, setDraft] = useState<CodeitlabCredentialsSettings>(codeitlab.credentials);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<null | "start" | "stop" | "download">(null);
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState(
    "Here is my key: sk-proj-AbCdEf0123456789AbCdEf0123456789\npassword: hunter2\n/private my home address is private /private",
  );
  const [scanResult, setScanResult] = useState<CodeitlabCredentialsScanResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const patch = (next: Partial<CodeitlabCredentialsSettings>) =>
    setDraft((current) => ({ ...current, ...next }));

  const save = async () => {
    unlockCodeitlabAudio();
    setSaving(true);
    setError(null);
    try {
      const result = await credentials.update(draft);
      if (result === null) {
        setError("Connect an environment to save these settings.");
      } else {
        playCodeitlabSfx("success");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the credentials settings.");
      playCodeitlabSfx("error");
    }
    setSaving(false);
  };

  const runGatewayAction = async (action: "start" | "stop") => {
    setBusy(action);
    setError(null);
    try {
      const result = action === "start" ? await credentials.start() : await credentials.stop();
      if (result === null) setError("Connect an environment to control the local gateway.");
      else playCodeitlabSfx("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local gateway action failed.");
      playCodeitlabSfx("error");
    }
    setBusy(null);
  };

  const downloadModel = async () => {
    setBusy("download");
    setError(null);
    try {
      const result = await credentials.downloadModel();
      if (result === null) setError("Connect an environment to download the model.");
      else playCodeitlabSfx("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download the local model.");
      playCodeitlabSfx("error");
    }
    setBusy(null);
  };

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await credentials.scan({ text: previewText, target: "preview" });
      if (result === null) setError("Connect an environment to run a local scan.");
      else {
        setScanResult(result);
        playCodeitlabSfx("success");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local scan failed.");
      playCodeitlabSfx("error");
    }
    setScanning(false);
  };

  const status = credentials.data;
  const model = status.model;
  const recentAudit = status.audit.toReversed().slice(0, 8);
  const kindTotals = (() => {
    const totals = new Map<CodeitlabCredentialsFindingKind, number>();
    for (const entry of status.audit) {
      for (const kind of entry.kinds) totals.set(kind, (totals.get(kind) ?? 0) + 1);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  })();

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="credentials">
      <CodeitlabSourceNote source={credentials.source} />

      <CodeitlabSectionHeading
        eyebrow="PRIVACY // LOCAL FIREWALL"
        title="Credentials proxy"
        description="Keep secrets on this machine. Before anything is sent to a provider, CodeItLab replaces API keys, passwords, tokens, private keys, personal data and /private blocks with deterministic fakes, then restores the real values in the answer. The check runs locally: patterns plus the smallest model that can do the job."
        action={
          <Button size="sm" variant="outline" onClick={() => credentials.refresh()}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        }
      />

      {error === null ? null : (
        <Alert variant="error" data-credentials-error>
          <AlertTitle>Credentials proxy</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {credentials.isPending && credentials.source === "local" ? (
        <CodeitlabLoadingRows rows={2} />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <CodeitlabCard data-credentials-switch>
              <div className="flex items-start justify-between gap-3 px-4 pt-4">
                <div className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-4 text-codeitlab-green" />
                  <div>
                    <h3 className="font-display text-sm font-semibold text-foreground">
                      Privacy firewall
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Opt-in. Off by default; nothing is inspected until you enable it.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) => patch({ enabled: checked })}
                  aria-label="Enable the credentials proxy"
                />
              </div>
              <div className="mt-3 space-y-3 px-4 pb-4">
                <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  Mask personal data (emails, phones, IBANs, cards)
                  <Switch
                    checked={draft.maskPersonalData}
                    onCheckedChange={(checked) => patch({ maskPersonalData: checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  Restore real values in answers and tool output
                  <Switch
                    checked={draft.restoreResponses}
                    onCheckedChange={(checked) => patch({ restoreResponses: checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  Refuse requests the local model flags but cannot classify
                  <Switch
                    checked={draft.blockOnModelFlag}
                    onCheckedChange={(checked) => patch({ blockOnModelFlag: checked })}
                  />
                </label>
              </div>
            </CodeitlabCard>

            <CodeitlabCard data-credentials-mode>
              <div className="space-y-3 px-4 pt-4 pb-4">
                <h3 className="font-display text-sm font-semibold text-foreground">
                  What gets masked
                </h3>
                <div className="space-y-1.5">
                  <span className="codeitlab-mono-label text-muted-foreground">Mode</span>
                  <Select
                    value={draft.mode}
                    onValueChange={(value) => patch({ mode: value as CodeitlabCredentialsMode })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          {mode.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <span className="codeitlab-mono-label text-muted-foreground">
                    /private blocks
                  </span>
                  <Select
                    value={draft.privateTag}
                    onValueChange={(value) =>
                      patch({ privateTag: value as CodeitlabCredentialsSettings["privateTag"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="mask">Mask the content</SelectItem>
                      <SelectItem value="block">Block the whole request</SelectItem>
                    </SelectPopup>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Wrap anything that must never leave:{" "}
                    <code className="font-mono text-2xs">/private … /private</code>,{" "}
                    <code className="font-mono text-2xs">[private]…[/private]</code> or{" "}
                    <code className="font-mono text-2xs">&lt;private&gt;…&lt;/private&gt;</code>.
                  </p>
                </div>
              </div>
            </CodeitlabCard>
          </div>

          <CodeitlabCard data-credentials-gateway>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <div className="flex items-center gap-2">
                <KeyRoundIcon className="size-4 text-codeitlab-cyan" />
                <h3 className="font-display text-sm font-semibold text-foreground">
                  Local gateway for CLI agents
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge size="sm" variant={status.running ? "success" : "secondary"}>
                  {status.running ? "listening" : "stopped"}
                </Badge>
                <Badge size="sm" variant="outline">
                  {status.mode}
                </Badge>
              </div>
            </div>
            <div className="space-y-3 px-4 pt-3 pb-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <span className="codeitlab-mono-label text-muted-foreground">Port</span>
                  <Input
                    className="w-28"
                    inputMode="numeric"
                    value={String(draft.gatewayPort)}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      patch({ gatewayPort: Number.isFinite(parsed) ? parsed : draft.gatewayPort });
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void runGatewayAction("start")}
                >
                  <PlayIcon className="size-3.5" />
                  {busy === "start" ? "Starting…" : "Start"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void runGatewayAction("stop")}
                >
                  <SquareIcon className="size-3.5" />
                  {busy === "stop" ? "Stopping…" : "Stop"}
                </Button>
                <Button size="sm" disabled={saving} onClick={() => void save()}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <p className="codeitlab-mono-label text-muted-foreground">Base URL</p>
                <code className="mt-1 block break-all font-mono text-xs text-foreground">
                  {status.gatewayUrl}
                </code>
                <p className="mt-2 text-xs text-muted-foreground">
                  Point an OpenAI/Anthropic-compatible agent at this URL and tell the gateway where
                  to forward with the{" "}
                  <code className="font-mono text-2xs">x-codeitlab-upstream</code> header (or{" "}
                  <code className="font-mono text-2xs">?upstream=</code>), e.g.{" "}
                  <code className="font-mono text-2xs">https://api.anthropic.com</code>. The gateway
                  only listens on 127.0.0.1.
                </p>
              </div>
            </div>
          </CodeitlabCard>

          <CodeitlabCard data-credentials-model>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
              <div>
                <h3 className="font-display text-sm font-semibold text-foreground">
                  Local check model
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {model.label} · v{model.version} · {formatBytes(model.sizeBytes)} ·{" "}
                  {model.state === "ready" ? "downloaded" : "bundled"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void downloadModel()}
              >
                <DownloadIcon className="size-3.5" />
                {busy === "download" ? "Downloading…" : "Download smallest model"}
              </Button>
            </div>
            <div className="px-4 pt-3 pb-4">
              <p className="text-xs text-muted-foreground">
                A hashed character n-gram classifier with 8,233 int8 weights: no runtime, no GPU, no
                network call at scan time. It only inspects tokens the patterns miss, and it is
                trained to stay quiet on git SHAs, checksums and identifiers. “Download” fetches the
                newest weights into the CodeItLab home; the bundled copy keeps working offline.
              </p>
              {model.detail === undefined ? null : (
                <p className="mt-2 text-xs text-muted-foreground">{model.detail}</p>
              )}
            </div>
          </CodeitlabCard>

          <CodeitlabCard data-credentials-preview>
            <div className="flex items-center gap-2 px-4 pt-4">
              <ScanLineIcon className="size-4 text-codeitlab-green" />
              <h3 className="font-display text-sm font-semibold text-foreground">
                Preview scan (local, nothing leaves)
              </h3>
            </div>
            <div className="space-y-3 px-4 pt-3 pb-4">
              <textarea
                className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-codeitlab-green/60"
                value={previewText}
                onChange={(event) => setPreviewText(event.target.value)}
                aria-label="Text to scan"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={scanning} onClick={() => void scan()}>
                  <ScanLineIcon className="size-3.5" />
                  {scanning ? "Scanning…" : "Scan locally"}
                </Button>
                {scanResult === null ? null : (
                  <Badge size="sm" variant={scanResult.blocked ? "error" : "success"}>
                    {scanResult.findings.length} finding
                    {scanResult.findings.length === 1 ? "" : "s"}
                    {scanResult.blocked ? " · blocked" : ""}
                  </Badge>
                )}
              </div>
              {scanResult === null ? null : (
                <>
                  <pre className="max-h-48 overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
                    {scanResult.masked}
                  </pre>
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set(scanResult.findings.map((finding) => finding.kind))].map(
                      (kind) => (
                        <Badge key={kind} size="sm" variant="outline">
                          {FINDING_LABELS[kind]}
                        </Badge>
                      ),
                    )}
                  </div>
                </>
              )}
            </div>
          </CodeitlabCard>

          <div className="grid gap-3 lg:grid-cols-3">
            {[
              { label: "Scans", value: status.scanned },
              { label: "Values masked", value: status.maskedValues },
              { label: "Requests blocked", value: status.blocked },
            ].map((stat) => (
              <CodeitlabCard key={stat.label}>
                <div className="px-4 py-4">
                  <p className="codeitlab-mono-label text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 font-display text-2xl font-semibold text-foreground">
                    {stat.value.toLocaleString()}
                  </p>
                </div>
              </CodeitlabCard>
            ))}
          </div>

          <CodeitlabCard data-credentials-audit>
            <div className="px-4 pt-4">
              <h3 className="font-display text-sm font-semibold text-foreground">
                Recent activity
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Counts and kinds only — the audit trail never stores a value.
              </p>
            </div>
            <div className="px-4 pt-3 pb-4">
              {recentAudit.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing scanned yet.</p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {recentAudit.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-foreground">{entry.target}</span>
                        {entry.kinds.map((kind) => (
                          <Badge key={`${entry.id}-${kind}`} size="sm" variant="outline">
                            {FINDING_LABELS[kind]}
                          </Badge>
                        ))}
                        {entry.blocked ? (
                          <Badge size="sm" variant="error">
                            blocked
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {entry.findings} value{entry.findings === 1 ? "" : "s"} ·{" "}
                        {formatTime(entry.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {kindTotals.length === 0 ? null : (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 pt-3">
                  {kindTotals.map(([kind, count]) => (
                    <Badge key={kind} size="sm" variant="secondary">
                      {FINDING_LABELS[kind]} × {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CodeitlabCard>
        </>
      )}
    </div>
  );
}

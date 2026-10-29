import { useState } from "react";
import {
  CopyIcon,
  DownloadIcon,
  KeyRoundIcon,
  PlayIcon,
  RefreshCwIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SquareIcon,
} from "lucide-react";

import type {
  CodeItLabCredentialsFindingKind,
  CodeItLabCredentialsMode,
  CodeItLabCredentialsScanResult,
  CodeItLabCredentialsSettings,
} from "@codeitlab/contracts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { useCodeItLabCredentials } from "../../codeitlab/api";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { playCodeItLabSfx, unlockCodeItLabAudio } from "../../codeitlab/audio";
import { FIREWALL_UPSTREAMS, firewallUpstreamUrl } from "../../codeitlab/upstreamUrl";
import {
  CodeItLabCard,
  CodeItLabPrimaryCard,
  CodeItLabLoadingRows,
  CodeItLabSectionHeading,
  CodeItLabSourceNote,
} from "./CodeItLabPrimitives";

const MODES: ReadonlyArray<{ value: CodeItLabCredentialsMode; label: string }> = [
  { value: "secrets", label: "Secrets only — keys, passwords, tokens" },
  { value: "balanced", label: "Balanced — secrets plus personal data" },
  { value: "max", label: "Maximum — also private IPs and network details" },
];

const FINDING_LABELS: Record<CodeItLabCredentialsFindingKind, string> = {
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
  keyword: "Keyword",
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

export function CodeItLabCredentialsPage() {
  const credentials = useCodeItLabCredentials();
  const { codeitlab } = useCodeItLabSettingsWriter();
  const [draft, setDraft] = useState<CodeItLabCredentialsSettings>(codeitlab.credentials);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<null | "start" | "stop" | "download">(null);
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState(
    "Here is my key: sk-proj-AbCdEf0123456789AbCdEf0123456789\npassword: hunter2\n/private my home address is private /private",
  );
  const [scanResult, setScanResult] = useState<CodeItLabCredentialsScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(codeitlab.credentials);

  const patch = (next: Partial<CodeItLabCredentialsSettings>) =>
    setDraft((current) => ({ ...current, ...next }));

  const save = async () => {
    unlockCodeItLabAudio();
    setSaving(true);
    setError(null);
    try {
      const result = await credentials.update(draft);
      if (result === null) {
        setError("Connect an environment to save these settings.");
      } else {
        playCodeItLabSfx("success");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the credentials settings.");
      playCodeItLabSfx("error");
    }
    setSaving(false);
  };

  const runGatewayAction = async (action: "start" | "stop") => {
    setBusy(action);
    setError(null);
    try {
      const result = action === "start" ? await credentials.start() : await credentials.stop();
      if (result === null) setError("Connect an environment to control the local gateway.");
      else playCodeItLabSfx("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local gateway action failed.");
      playCodeItLabSfx("error");
    }
    setBusy(null);
  };

  const downloadModel = async () => {
    setBusy("download");
    setError(null);
    try {
      const result = await credentials.downloadModel();
      if (result === null) setError("Connect an environment to download the model.");
      else playCodeItLabSfx("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download the local model.");
      playCodeItLabSfx("error");
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
        playCodeItLabSfx("success");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local scan failed.");
      playCodeItLabSfx("error");
    }
    setScanning(false);
  };

  const status = credentials.data;
  const gatewayState =
    busy !== null
      ? "A gateway action is running; the buttons wait for it to finish."
      : status.running
        ? "The gateway is running; Start is disabled until you stop it."
        : "The gateway is stopped; Stop is disabled until you start it.";
  const model = status.model;
  const recentAudit = status.audit.toReversed().slice(0, 8);
  const kindTotals = (() => {
    const totals = new Map<CodeItLabCredentialsFindingKind, number>();
    for (const entry of status.audit) {
      for (const kind of entry.kinds) totals.set(kind, (totals.get(kind) ?? 0) + 1);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  })();

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="credentials">
      <CodeItLabSourceNote source={credentials.source} />

      <CodeItLabSectionHeading
        eyebrow="PRIVACY // LOCAL FIREWALL"
        title="Credentials proxy"
        description="Keep secrets on this machine. Before anything is sent to a provider, CodeItLab replaces API keys, passwords, tokens, private keys, personal data and /private blocks with deterministic fakes — app turns included. The gateway also restores the real values in answers and tool output. The check runs locally: patterns plus the smallest model that can do the job."
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
        <CodeItLabLoadingRows label="Loading credentials" rows={2} />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <CodeItLabPrimaryCard data-credentials-switch>
              <div className="flex items-start justify-between gap-3 px-4 pt-4">
                <div className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-4 text-codeitlab-green" />
                  <div>
                    <h3 className="font-display text-sm font-semibold text-foreground">
                      Privacy firewall
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      On by default: credentials and personal data are replaced before a prompt
                      leaves, and the real values are restored in the answer.
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
                  Mask personal data too (emails, phones, IBANs, cards)
                  <Switch
                    checked={draft.maskPersonalData}
                    onCheckedChange={(checked) => patch({ maskPersonalData: checked })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  Restore real values in gateway answers and tool output
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
                <p className="text-xs text-muted-foreground">
                  App turns mask the prompt and restore the fakes in the answer automatically. The
                  restore switch covers the loopback gateway and CLI agents that use it.
                </p>
              </div>
            </CodeItLabPrimaryCard>

            <CodeItLabCard data-credentials-mode>
              <div className="space-y-3 px-4 pt-4 pb-4">
                <h3 className="font-display text-sm font-semibold text-foreground">
                  What gets masked
                </h3>
                <div className="space-y-1.5">
                  <span className="codeitlab-mono-label text-muted-foreground">Mode</span>
                  <Select
                    value={draft.mode}
                    onValueChange={(value) => patch({ mode: value as CodeItLabCredentialsMode })}
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
                      patch({ privateTag: value as CodeItLabCredentialsSettings["privateTag"] })
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
            </CodeItLabCard>
          </div>

          <CodeItLabCard data-credentials-keywords>
            <div className="space-y-3 px-4 pt-4 pb-4">
              <div>
                <h3 className="font-display text-sm font-semibold text-foreground">
                  Your own keywords
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Words that must never reach a provider, whatever the mode and whatever the pattern
                  rules think: an internal project name, a client, a domain of your own. Matching
                  ignores case and masks every occurrence.
                </p>
              </div>
              <div className="space-y-1.5">
                <label
                  className="codeitlab-mono-label text-muted-foreground"
                  htmlFor="credentials-keywords"
                >
                  One per line
                </label>
                <Textarea
                  id="credentials-keywords"
                  onChange={(event) =>
                    patch({
                      keywords: event.currentTarget.value
                        .split("\n")
                        .map((line) => line.trim())
                        .filter((line) => line !== ""),
                    })
                  }
                  placeholder="acme-internal"
                  rows={3}
                  value={(draft.keywords ?? []).join("\n")}
                />
              </div>
              <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  Hand masked values to programs as environment variables
                  <span className="mt-1 block text-2xs">
                    Values stay on this machine as
                    <code className="mx-1 font-mono text-2xs">CODEITLAB_MASKED_*</code>
                    variables, so a script under the app keeps working without seeing the real ones.
                  </span>
                </span>
                <Switch
                  checked={draft.exposeKeywordsToPrograms}
                  onCheckedChange={(checked) => patch({ exposeKeywordsToPrograms: checked })}
                />
              </label>
            </div>
          </CodeItLabCard>

          <CodeItLabCard data-credentials-gateway>
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
                  <label
                    className="codeitlab-mono-label text-muted-foreground"
                    htmlFor="gateway-port"
                  >
                    Port
                  </label>
                  <Input
                    className="w-28"
                    id="gateway-port"
                    inputMode="numeric"
                    value={String(draft.gatewayPort)}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      patch({ gatewayPort: Number.isFinite(parsed) ? parsed : draft.gatewayPort });
                    }}
                  />
                </div>
                <Button
                  aria-describedby="credentials-gateway-state"
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || status.running}
                  onClick={() => void runGatewayAction("start")}
                >
                  <PlayIcon className="size-3.5" />
                  {busy === "start" ? "Starting…" : "Start"}
                </Button>
                <Button
                  aria-describedby="credentials-gateway-state"
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !status.running}
                  onClick={() => void runGatewayAction("stop")}
                >
                  <SquareIcon className="size-3.5" />
                  {busy === "stop" ? "Stopping…" : "Stop"}
                </Button>
                <Button
                  aria-describedby="credentials-save-state"
                  size="sm"
                  disabled={saving || !dirty}
                  onClick={() => void save()}
                >
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </div>
              <p
                aria-live="polite"
                className="text-2xs text-muted-foreground"
                id="credentials-save-state"
              >
                {dirty
                  ? "Unsaved changes; the gateway keeps the settings it started with until you save."
                  : "Every change here is saved."}
              </p>
              <p
                aria-live="polite"
                className="text-2xs text-muted-foreground"
                id="credentials-gateway-state"
              >
                {gatewayState}
              </p>
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <p className="codeitlab-mono-label text-muted-foreground">Base URL</p>
                <code className="mt-1 block break-all font-mono text-xs text-foreground">
                  {status.gatewayUrl}
                </code>
                <p className="mt-2 text-xs text-muted-foreground">
                  The gateway only listens on 127.0.0.1. Agents that can send a header use{" "}
                  <code className="font-mono text-2xs">x-codeitlab-upstream</code>; agents that only
                  accept a base URL use one of the copy-ready URLs below — the upstream is encoded
                  in the path, so tool results and file contents those agents read are masked too.
                </p>
                <div className="mt-3 space-y-2">
                  {FIREWALL_UPSTREAMS.map((entry) => {
                    const value = firewallUpstreamUrl(status.gatewayUrl, entry.upstream);
                    return (
                      <div key={entry.id} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            {entry.label} ·{" "}
                            <code className="font-mono text-2xs">{entry.environmentVariable}</code>
                          </p>
                          <code className="block break-all font-mono text-2xs text-foreground">
                            {value}
                          </code>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void navigator.clipboard.writeText(value).then(() => {
                              setCopied(entry.id);
                              playCodeItLabSfx("click");
                            });
                          }}
                        >
                          <CopyIcon className="size-3.5" />
                          {copied === entry.id ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    );
                  })}
                  <p aria-live="polite" className="sr-only" role="status">
                    {copied === null
                      ? ""
                      : `Copied the ${FIREWALL_UPSTREAMS.find((entry) => entry.id === copied)?.label ?? "gateway"} URL.`}
                  </p>
                </div>
              </div>
            </div>
          </CodeItLabCard>

          <CodeItLabCard data-credentials-model>
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
          </CodeItLabCard>

          <CodeItLabCard data-credentials-preview>
            <div className="flex items-center gap-2 px-4 pt-4">
              <ScanLineIcon className="size-4 text-codeitlab-green" />
              <h3 className="font-display text-sm font-semibold text-foreground">
                Preview scan (local, nothing leaves)
              </h3>
            </div>
            <div className="space-y-3 px-4 pt-3 pb-4">
              <Textarea
                aria-label="Text to scan"
                className="min-h-24"
                mono
                onChange={(event) => setPreviewText(event.target.value)}
                value={previewText}
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
          </CodeItLabCard>

          <div className="grid gap-3 lg:grid-cols-3">
            {[
              { label: "Scans", value: status.scanned },
              { label: "Values masked", value: status.maskedValues },
              { label: "Requests blocked", value: status.blocked },
            ].map((stat) => (
              <CodeItLabCard key={stat.label}>
                <div className="px-4 py-4">
                  <p className="codeitlab-mono-label text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 font-display text-2xl font-semibold text-foreground">
                    {stat.value.toLocaleString()}
                  </p>
                </div>
              </CodeItLabCard>
            ))}
          </div>

          <CodeItLabCard data-credentials-audit>
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
          </CodeItLabCard>
        </>
      )}
    </div>
  );
}

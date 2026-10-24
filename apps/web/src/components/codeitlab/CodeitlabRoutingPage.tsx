import { useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GaugeIcon,
  RouteIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";

import type { CodeitlabRoutingSettings } from "@t3tools/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { useCodeitlabRouting } from "../../codeitlab/api";
import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import {
  fallbackModelOptions,
  fallbackProviderOptions,
  FIRST_HEALTHY_PROVIDER_LABEL,
  isFallbackDecision,
  PROVIDER_DEFAULT_MODEL_LABEL,
  PROVIDER_FAILURE_COOLDOWN_OPTIONS,
} from "../../codeitlab/fallbackSettings";
import {
  fastestSpeed,
  formatHealthAge,
  formatHealthInterval,
  formatHealthLatency,
  formatModelCount,
  formatModelLatency,
  formatNextCheck,
  HEALTH_INTERVAL_OPTIONS,
  healthStatusLabel,
  healthStatusVariant,
  SPEED_PROBE_MODEL_OPTIONS,
  DEEP_SCAN_CONCURRENCY_OPTIONS,
  DEEP_SCAN_TIMEOUT_OPTIONS,
  deepScanProgress,
  deepScanSummary,
  providerScanSummary,
  speedProbeChecking,
  speedProbeSummary,
} from "../../codeitlab/routingHealth";
import {
  codeitlabProviderKindLabel,
  codeitlabProviderLabel,
  codeitlabProviderName,
} from "../../codeitlab/providerLabels";
import {
  CodeitlabCard,
  CodeitlabMeter,
  CodeitlabSectionHeading,
  CodeitlabSettingRow,
  CodeitlabSlider,
  CodeitlabSourceNote,
} from "./CodeitlabPrimitives";

const MODE_LABELS = {
  manual: "Manual",
  auto: "Auto",
  omniroute: "OmniRoute",
} as const;

const TASK_CLASSES = ["coding", "reasoning", "vision", "chat", "fast", "cheap"] as const;

export function CodeitlabRoutingPage() {
  const routing = useCodeitlabRouting();
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  const [draft, setDraft] = useState<CodeitlabRoutingSettings | null>(null);
  const [prompt, setPrompt] = useState("");
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  // One timestamp per mount: relative labels stay stable between renders and
  // there is no repainting countdown. The Check now button refreshes the data.
  const [nowMs] = useState(() => Date.now());
  const settings = draft ?? codeitlab.routing;
  const deepProgress = deepScanProgress(routing.health);
  const deepSummary = deepProgress === null ? deepScanSummary(routing.health) : null;
  const probeChecking = deepProgress === null ? speedProbeChecking(routing.health) : null;
  const probeSummary =
    probeChecking === null && deepSummary === null ? speedProbeSummary(routing.health) : null;
  const probePercent =
    probeChecking !== null && probeChecking.total > 0
      ? Math.min(100, Math.round((probeChecking.checked / probeChecking.total) * 100))
      : 0;
  const fallbackProviderChoices = fallbackProviderOptions(routing.data.providers);
  const fallbackInstance =
    routing.data.providers.find(
      (provider) => provider.providerInstanceId === settings.fallbackInstanceId,
    ) ?? null;
  const fallbackModelChoices = fallbackModelOptions(fallbackInstance?.models);
  const fallbackProviderLabel =
    fallbackProviderChoices.find((option) => option.value === settings.fallbackInstanceId)?.label ??
    (settings.fallbackInstanceId.length === 0
      ? FIRST_HEALTHY_PROVIDER_LABEL
      : codeitlabProviderLabel(settings.fallbackInstanceId));
  const fallbackModelLabel =
    fallbackInstance === null
      ? "Choose a backup provider first"
      : (fallbackModelChoices.find((option) => option.value === settings.fallbackModel)?.label ??
        PROVIDER_DEFAULT_MODEL_LABEL);

  const updateRouting = (patch: Partial<CodeitlabRoutingSettings>) => {
    const next = { ...settings, ...patch };
    setDraft(next);
    update({ routing: next });
  };

  const moveProvider = (index: number, direction: -1 | 1) => {
    const order = [...settings.providerOrder];
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const current = order[index];
    const swap = order[target];
    if (current === undefined || swap === undefined) return;
    order[index] = swap;
    order[target] = current;
    updateRouting({ providerOrder: order });
  };

  const handleDecide = async () => {
    const value = prompt.trim();
    if (value.length === 0) return;
    setDeciding(true);
    const decision = await routing.decide({ prompt: value, projectId: null, attachments: [] });
    setDeciding(false);
    setDecisionMessage(
      decision === null
        ? "Routing RPC is not wired yet; the preview catalog below explains the intended decision shape."
        : `${decision.taskClass}: ${codeitlabProviderLabel(decision.providerInstanceId)} / ${decision.model} — ${decision.reason}`,
    );
  };

  const handleCheckHealth = async () => {
    setCheckingHealth(true);
    await routing.checkHealth();
    setCheckingHealth(false);
  };

  const weightTotal = settings.weights.quota + settings.weights.smartness + settings.weights.speed;

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="routing">
      <CodeitlabSourceNote source={routing.source} />
      <CodeitlabSectionHeading
        eyebrow="Routing"
        title="Pick the right harness per task"
        description="When the user does not choose a provider, CodeitLab classifies the task and scores providers by remaining quota, smartness, and speed. Every decision keeps a human-readable reason."
      />

      <CodeitlabCard>
        <CodeitlabSettingRow
          title="Mode"
          description="Manual uses the thread's selected provider. Auto scores every provider. OmniRoute delegates to a local OmniRoute gateway."
          control={
            <Select
              value={settings.mode}
              onValueChange={(value) => {
                if (value === "manual" || value === "auto" || value === "omniroute") {
                  updateRouting({ mode: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Routing mode">
                <SelectValue>{MODE_LABELS[settings.mode]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {Object.entries(MODE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} hideIndicator value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeitlabSettingRow
          title="Allow fallback"
          description="If the preferred provider fails or is rate-limited, retry the same turn on the next candidate."
          control={
            <Switch
              aria-label="Allow provider fallback"
              checked={settings.allowFallback}
              onCheckedChange={(checked) => updateRouting({ allowFallback: checked })}
            />
          }
        />
        <CodeitlabSettingRow
          title="Record history"
          description="Keep a short audit of routing decisions so the panel can explain past choices."
          control={
            <Switch
              aria-label="Record routing history"
              checked={settings.recordHistory}
              onCheckedChange={(checked) => updateRouting({ recordHistory: checked })}
            />
          }
        />
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-cyan/80">Quota health</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              Probe providers on a schedule
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge size="sm" variant={routing.healthSource === "server" ? "success" : "secondary"}>
              {routing.healthSource === "server" ? "live" : "preview"}
            </Badge>
            <Button
              data-health-check-now="true"
              disabled={checkingHealth}
              size="sm"
              variant="outline"
              onClick={() => void handleCheckHealth()}
            >
              {checkingHealth ? "Checking…" : "Check now"}
            </Button>
          </div>
        </div>
        {deepProgress !== null ? (
          <div
            className="flex flex-col gap-2 border-b border-border/50 bg-codeitlab-cyan/5 px-4 py-3"
            data-codeitlab-speed-probe="deep"
            data-speed-probe-checked={String(deepProgress.checked)}
            data-speed-probe-total={String(deepProgress.total)}
            data-speed-probe-ok={String(deepProgress.ok)}
            data-speed-probe-failed={String(deepProgress.failed)}
            data-speed-probe-providers={String(deepProgress.providers)}
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <SparklesIcon className="size-3.5 shrink-0 text-codeitlab-cyan" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">
                Scanning every advertised model…
              </span>
              <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                {deepProgress.checked} / {deepProgress.total} models
              </span>
              <span className="text-2xs text-muted-foreground">
                {deepProgress.ok} available
                {deepProgress.failed === 0 ? "" : ` · ${deepProgress.failed} failed`}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full rounded-full bg-codeitlab-cyan"
                style={{ width: `${deepProgress.percent}%` }}
              />
            </div>
            <p className="text-2xs text-muted-foreground">
              The deep scan measures every model each provider advertises, once, so the router only
              picks models that actually answered. Failed models never win a turn.
            </p>
          </div>
        ) : probeChecking !== null ? (
          <div
            className="flex flex-col gap-2 border-b border-border/50 bg-codeitlab-cyan/5 px-4 py-3"
            data-codeitlab-speed-probe="checking"
            data-speed-probe-checked={String(probeChecking.checked)}
            data-speed-probe-total={String(probeChecking.total)}
            data-speed-probe-providers={String(probeChecking.providers)}
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <SparklesIcon className="size-3.5 shrink-0 text-codeitlab-cyan" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">
                Checking all harness and models…
              </span>
              <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                {probeChecking.checked} / {probeChecking.total} models
              </span>
              <span className="text-2xs text-muted-foreground">
                {probeChecking.providers} {probeChecking.providers === 1 ? "provider" : "providers"}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full rounded-full bg-codeitlab-cyan"
                style={{ width: `${probePercent}%` }}
              />
            </div>
            <p className="text-2xs text-muted-foreground">
              CodeitLab sends a one-word{" "}
              <code className="rounded-sm bg-muted px-1 py-0.5 font-mono">hi</code> to each model to
              measure real speed. Failed models are retried automatically.
            </p>
          </div>
        ) : deepSummary !== null ? (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5 text-2xs text-muted-foreground"
            data-codeitlab-speed-probe="deep-done"
            data-speed-probe-total={String(routing.health.speedProbe?.total ?? 0)}
            data-speed-probe-ok={String(routing.health.speedProbe?.okCount ?? 0)}
            data-speed-probe-failed={String(routing.health.speedProbe?.failedCount ?? 0)}
            data-speed-probe-providers={String(
              routing.health.entries.filter((entry) => entry.speedProbe?.mode === "deep").length,
            )}
          >
            <GaugeIcon className="size-3.5 shrink-0 text-codeitlab-green" aria-hidden="true" />
            <span>{deepSummary}</span>
          </div>
        ) : probeSummary === null ? null : (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5 text-2xs text-muted-foreground"
            data-codeitlab-speed-probe="done"
            data-speed-probe-models={String(
              routing.health.entries.reduce((sum, entry) => sum + (entry.speeds?.length ?? 0), 0),
            )}
            data-speed-probe-providers={String(
              routing.health.entries.filter((entry) => (entry.speeds?.length ?? 0) > 0).length,
            )}
          >
            <GaugeIcon className="size-3.5 shrink-0 text-codeitlab-green" aria-hidden="true" />
            <span>{probeSummary}</span>
          </div>
        )}
        <CodeitlabSettingRow
          title="Automatic checks"
          description="CodeitLab probes every provider on this cadence: binary present, login valid, quota left. Failing providers are skipped by routing."
          control={
            <Select
              value={String(settings.healthCheckMinutes)}
              onValueChange={(value) => updateRouting({ healthCheckMinutes: Number(value) })}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label="Health check interval"
              >
                <SelectValue>{formatHealthInterval(settings.healthCheckMinutes)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {HEALTH_INTERVAL_OPTIONS.map((minutes) => (
                  <SelectItem key={minutes} hideIndicator value={String(minutes)}>
                    {formatHealthInterval(minutes)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeitlabSettingRow
          title="Route per task"
          description="Use the fastest model for quick questions and the smartest for coding/reasoning inside the winning provider."
          control={
            <Switch
              aria-label="Route per task"
              checked={settings.routePerTask}
              onCheckedChange={(checked) => updateRouting({ routePerTask: checked })}
            />
          }
        />
        <CodeitlabSettingRow
          title="Measure real model speed"
          description="Sends a one-word “hi” to each candidate model on every probe and uses the measured latency in the router's speed score. Failed models are retried automatically."
          control={
            <Switch
              aria-label="Measure real model speed"
              checked={settings.speedProbe}
              data-codeitlab-setting="speedProbe"
              onCheckedChange={(checked) => updateRouting({ speedProbe: checked })}
            />
          }
        />
        <CodeitlabSettingRow
          title="Models per provider to probe"
          description="How many candidate models each provider measures per probe. Fewer models finish faster; more models give the router a better speed signal."
          control={
            <Select
              disabled={!settings.speedProbe}
              value={String(settings.speedProbeModelsPerProvider)}
              onValueChange={(value) =>
                updateRouting({ speedProbeModelsPerProvider: Number(value) })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label="Models per provider to probe"
                data-codeitlab-setting="speedProbeModelsPerProvider"
              >
                <SelectValue>
                  {settings.speedProbeModelsPerProvider === 1
                    ? "1 model"
                    : `${settings.speedProbeModelsPerProvider} models`}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SPEED_PROBE_MODEL_OPTIONS.map((count) => (
                  <SelectItem key={count} hideIndicator value={String(count)}>
                    {count === 1 ? "1 model" : `${count} models`}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeitlabSettingRow
          title="Scan every model on first run"
          description="Measures every model each provider advertises (a one-word “hi” turn per model) and remembers which ones answer and how fast. Untested or failed models are never routed."
          control={
            <Switch
              aria-label="Scan every model on first run"
              checked={settings.deepScan}
              data-codeitlab-setting="deepScan"
              onCheckedChange={(checked) => updateRouting({ deepScan: checked })}
            />
          }
        />
        <CodeitlabSettingRow
          title="Deep scan concurrency"
          description="How many models the scan measures at the same time. Higher finishes faster but hits the provider harder."
          control={
            <Select
              disabled={!settings.deepScan}
              value={String(settings.deepScanConcurrency)}
              onValueChange={(value) => updateRouting({ deepScanConcurrency: Number(value) })}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label="Deep scan concurrency"
                data-codeitlab-setting="deepScanConcurrency"
              >
                <SelectValue>{`${settings.deepScanConcurrency} at a time`}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {DEEP_SCAN_CONCURRENCY_OPTIONS.map((count) => (
                  <SelectItem key={count} hideIndicator value={String(count)}>
                    {`${count} at a time`}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeitlabSettingRow
          title="Deep scan timeout"
          description="How long one model gets to answer before the scan marks it failed and stops routing to it."
          control={
            <Select
              disabled={!settings.deepScan}
              value={String(settings.deepScanTimeoutSeconds)}
              onValueChange={(value) => updateRouting({ deepScanTimeoutSeconds: Number(value) })}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label="Deep scan timeout"
                data-codeitlab-setting="deepScanTimeoutSeconds"
              >
                <SelectValue>{`${settings.deepScanTimeoutSeconds} s`}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {DEEP_SCAN_TIMEOUT_OPTIONS.map((seconds) => (
                  <SelectItem key={seconds} hideIndicator value={String(seconds)}>
                    {`${seconds} s`}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeitlabSettingRow
          title="Back up the provider automatically"
          description="When a provider fails a turn (auth, quota, HTTP error), CodeitLab skips it for a while and sends new Auto router turns to the backup provider."
          control={
            <Switch
              aria-label="Back up the provider automatically"
              checked={settings.fallbackOnProviderFailure}
              data-codeitlab-setting="fallbackOnProviderFailure"
              onCheckedChange={(checked) => updateRouting({ fallbackOnProviderFailure: checked })}
            />
          }
        />
        <CodeitlabSettingRow
          title="Backup provider"
          description="Where Auto router turns go while the failing provider cools down. The first healthy provider adapts automatically when the provider set changes."
          control={
            <Select
              disabled={!settings.fallbackOnProviderFailure}
              value={settings.fallbackInstanceId}
              onValueChange={(value) =>
                // A model slug only means something on the provider it came from.
                updateRouting({ fallbackInstanceId: value ?? "", fallbackModel: "" })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-48"
                aria-label="Backup provider"
                data-codeitlab-setting="fallbackInstanceId"
              >
                <SelectValue>{fallbackProviderLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {fallbackProviderChoices.map((option) => (
                  <SelectItem key={option.value} hideIndicator value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeitlabSettingRow
          title="Backup model"
          description="Model the backup provider uses. Provider default follows that provider's own choice and survives model renames."
          control={
            <Select
              disabled={!settings.fallbackOnProviderFailure || fallbackInstance === null}
              value={settings.fallbackModel}
              onValueChange={(value) => updateRouting({ fallbackModel: value ?? "" })}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-48"
                aria-label="Backup model"
                data-codeitlab-setting="fallbackModel"
              >
                <SelectValue>{fallbackModelLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {fallbackModelChoices.map((option) => (
                  <SelectItem key={option.value} hideIndicator value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeitlabSettingRow
          title="Skip a failing provider for"
          description="How long a provider stays out of Auto router after a failed turn. Turns keep flowing to the backup in the meantime."
          control={
            <Select
              disabled={!settings.fallbackOnProviderFailure}
              value={String(settings.providerFailureCooldownMinutes)}
              onValueChange={(value) =>
                updateRouting({ providerFailureCooldownMinutes: Number(value) })
              }
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label="Skip a failing provider for"
                data-codeitlab-setting="providerFailureCooldownMinutes"
              >
                <SelectValue>{`${settings.providerFailureCooldownMinutes} min`}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {PROVIDER_FAILURE_COOLDOWN_OPTIONS.map((minutes) => (
                  <SelectItem key={minutes} hideIndicator value={String(minutes)}>
                    {`${minutes} min`}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeitlabSettingRow
          title="Auto router in the model picker"
          description="Pick “Auto router” in the composer model picker and every turn is routed across all models from every enabled app, using the task class, quota health, and the weights below. Picking a concrete model turns it off again."
          control={
            <Badge size="sm" variant="success" data-codeitlab-auto-router-hint="true">
              picker option
            </Badge>
          }
        />
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 px-4 py-2.5 text-2xs text-muted-foreground"
          data-codeitlab-health-summary="true"
          data-health-checked-at={routing.health.checkedAt}
          data-health-next-check={routing.health.nextCheckAt}
          data-health-interval={String(routing.health.intervalMinutes)}
        >
          <span>Last check {formatHealthAge(routing.health.checkedAt, nowMs)}</span>
          <span>next {formatNextCheck(routing.health.nextCheckAt, nowMs)}</span>
          <span>{formatHealthInterval(routing.health.intervalMinutes)}</span>
          <span>{routing.health.source}</span>
        </div>
        {routing.health.entries.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground">
            No health snapshot yet. Run a check to see which providers can serve turns.
          </p>
        ) : (
          <ul className="divide-y divide-border/50" data-health-entries="true">
            {routing.health.entries.map((entry) => {
              const latency = formatHealthLatency(entry.latencyMs);
              const fastest = fastestSpeed(entry.speeds);
              const scanSummary = providerScanSummary(entry);
              return (
                <li
                  key={entry.providerInstanceId}
                  className="flex flex-col gap-2 px-4 py-3"
                  data-health-provider={entry.providerInstanceId}
                  data-health-status={entry.status}
                  data-provider-scan-mode={entry.speedProbe?.mode ?? "light"}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {codeitlabProviderName(entry.name)}
                    </span>
                    <span className="font-mono text-2xs text-muted-foreground">
                      {codeitlabProviderKindLabel(entry.providerKind)}
                    </span>
                    <Badge size="sm" variant={healthStatusVariant(entry.status)}>
                      {healthStatusLabel(entry.status)}
                    </Badge>
                    <span className="font-mono text-2xs text-muted-foreground">
                      {formatModelCount(entry.models)}
                    </span>
                    {scanSummary === null ? null : (
                      <span
                        className="font-mono text-2xs text-codeitlab-cyan/80"
                        data-provider-scan-summary="true"
                      >
                        {scanSummary}
                      </span>
                    )}
                    {latency === null ? null : (
                      <span className="font-mono text-2xs text-muted-foreground">{latency}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    quota <CodeitlabMeter value={entry.quota} />
                  </div>
                  {entry.speeds === undefined || entry.speeds.length === 0 ? null : (
                    <div
                      className="flex flex-wrap items-center gap-x-2 gap-y-1"
                      data-health-speeds="true"
                    >
                      <span className="text-2xs text-muted-foreground">speed</span>
                      {entry.speeds.map((speed) => {
                        const isFastest = speed.ok && fastest?.model === speed.model;
                        const retrying = entry.speedProbe?.retrying?.includes(speed.model) ?? false;
                        return (
                          <span
                            key={speed.model}
                            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/40 px-1.5 py-0.5 font-mono text-2xs"
                            data-speed-model={speed.model}
                            data-speed-latency-ms={String(Math.round(speed.latencyMs))}
                            data-speed-ok={speed.ok ? "true" : "false"}
                          >
                            <span className="max-w-40 truncate text-foreground">{speed.model}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {formatModelLatency(speed.latencyMs)}
                            </span>
                            {speed.ok ? null : <span className="text-destructive">failed</span>}
                            {isFastest ? (
                              <Badge size="sm" variant="success">
                                fastest
                              </Badge>
                            ) : null}
                            {retrying ? (
                              <span className="text-warning-foreground">retrying</span>
                            ) : null}
                            {speed.ok || speed.error === undefined ? null : (
                              <span className="max-w-48 truncate text-destructive/80">
                                {speed.error}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {entry.detail === undefined ? null : (
                    <p className="text-2xs text-muted-foreground">{entry.detail}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="border-b border-border/60 px-4 py-3">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Scoring weights</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Weights are normalized when scoring; they do not need to add up to 100%. Current sum:{" "}
            {Math.round(weightTotal * 100)}%.
          </p>
        </div>
        <CodeitlabSettingRow
          title="Quota"
          description="Prefer providers with headroom left."
          control={
            <CodeitlabSlider
              id="codeitlab-routing-quota"
              label="Quota weight"
              max={100}
              min={0}
              onChange={(value) =>
                updateRouting({ weights: { ...settings.weights, quota: value / 100 } })
              }
              step={5}
              value={Math.round(settings.weights.quota * 100)}
              valueLabel={`${Math.round(settings.weights.quota * 100)}%`}
            />
          }
        />
        <CodeitlabSettingRow
          title="Smartness"
          description="Prefer the strongest model for the task class."
          control={
            <CodeitlabSlider
              id="codeitlab-routing-smartness"
              label="Smartness weight"
              max={100}
              min={0}
              onChange={(value) =>
                updateRouting({ weights: { ...settings.weights, smartness: value / 100 } })
              }
              step={5}
              value={Math.round(settings.weights.smartness * 100)}
              valueLabel={`${Math.round(settings.weights.smartness * 100)}%`}
            />
          }
        />
        <CodeitlabSettingRow
          title="Speed"
          description="Prefer lower latency for interactive turns."
          control={
            <CodeitlabSlider
              id="codeitlab-routing-speed"
              label="Speed weight"
              max={100}
              min={0}
              onChange={(value) =>
                updateRouting({ weights: { ...settings.weights, speed: value / 100 } })
              }
              step={5}
              value={Math.round(settings.weights.speed * 100)}
              valueLabel={`${Math.round(settings.weights.speed * 100)}%`}
            />
          }
        />
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="border-b border-border/60 px-4 py-3">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Provider order</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tie-breaker order. Use the arrows to move a provider up or down.
          </p>
        </div>
        {settings.providerOrder.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground">
            No explicit order yet. Providers are scored directly; add an order once the catalog
            arrives from the environment.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {settings.providerOrder.map((providerId, index) => (
              <li key={providerId} className="flex items-center gap-2 px-4 py-2.5">
                <span className="w-5 font-mono text-2xs text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {providerId}
                </span>
                <Button
                  aria-label={`Move ${providerId} up`}
                  disabled={index === 0}
                  size="icon-micro"
                  variant="ghost-muted"
                  onClick={() => moveProvider(index, -1)}
                >
                  <ArrowUpIcon className="size-3" />
                </Button>
                <Button
                  aria-label={`Move ${providerId} down`}
                  disabled={index === settings.providerOrder.length - 1}
                  size="icon-micro"
                  variant="ghost-muted"
                  onClick={() => moveProvider(index, 1)}
                >
                  <ArrowDownIcon className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-cyan/80">OmniRoute</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">Virtual auto models</p>
          </div>
          <Switch
            aria-label="Enable OmniRoute"
            checked={settings.omniRoute.enabled}
            onCheckedChange={(checked) =>
              updateRouting({ omniRoute: { ...settings.omniRoute, enabled: checked } })
            }
          />
        </div>
        <CodeitlabSettingRow
          title="Gateway URL"
          description="Local OmniRoute endpoint. The API key is read from the environment variable below."
          control={
            <Input
              aria-label="OmniRoute gateway URL"
              className="w-full sm:w-72"
              value={settings.omniRoute.baseUrl}
              onChange={(event) =>
                updateRouting({
                  omniRoute: { ...settings.omniRoute, baseUrl: event.currentTarget.value },
                })
              }
            />
          }
        />
        <CodeitlabSettingRow
          title="API key environment variable"
          description="Only the variable name is stored; the value never leaves the environment."
          control={
            <Input
              aria-label="OmniRoute API key environment variable"
              className="w-full sm:w-72"
              value={settings.omniRoute.apiKeyEnv}
              onChange={(event) =>
                updateRouting({
                  omniRoute: { ...settings.omniRoute, apiKeyEnv: event.currentTarget.value },
                })
              }
            />
          }
        />
        <div className="px-4 py-3">
          <p className="codeitlab-mono-label text-muted-foreground">Virtual models</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settings.omniRoute.virtualModels.map((model) => (
              <Badge key={model} size="sm" variant="info">
                {model}
              </Badge>
            ))}
          </div>
        </div>
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="border-b border-border/60 px-4 py-3">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Try a route</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Send a prompt through the router to see which provider it would pick. This does not
            start a turn.
          </p>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row">
          <Input
            aria-label="Prompt to route"
            placeholder="e.g. refactor the auth middleware and add tests"
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
          <Button
            className="shrink-0"
            disabled={deciding || prompt.trim().length === 0}
            size="sm"
            onClick={() => void handleDecide()}
          >
            <WandSparklesIcon className="size-3.5" />
            {deciding ? "Deciding…" : "Decide"}
          </Button>
        </div>
        {decisionMessage === null ? null : (
          <p className="px-4 pb-3 text-xs text-muted-foreground" role="status">
            {decisionMessage}
          </p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-border/50 px-4 py-3">
          {TASK_CLASSES.map((taskClass) => (
            <Badge key={taskClass} size="sm" variant="secondary">
              {taskClass}
            </Badge>
          ))}
        </div>
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <RouteIcon className="size-3.5 text-codeitlab-green" />
          <p className="text-sm font-medium text-foreground">Provider catalog</p>
        </div>
        <ul className="divide-y divide-border/50">
          {routing.data.providers.map((provider) => (
            <li key={provider.providerInstanceId} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {codeitlabProviderName(provider.name)}
                </span>
                <Badge size="sm" variant={provider.available ? "success" : "error"}>
                  {provider.available ? "available" : "unavailable"}
                </Badge>
                <span className="font-mono text-2xs text-muted-foreground">
                  {provider.models.join(" · ")}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  quota <CodeitlabMeter value={provider.quota} />
                </span>
                <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  smartness <CodeitlabMeter value={provider.smartness} />
                </span>
                <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  speed <CodeitlabMeter value={provider.speed} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="border-b border-border/60 px-4 py-3">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Recent decisions</p>
        </div>
        {routing.history.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground">
            No decisions recorded yet. Enable history above to keep an audit trail.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {routing.history.map((decision) => (
              <li key={decision.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="sm" variant="info">
                    {decision.taskClass}
                  </Badge>
                  <span className="font-mono text-xs text-foreground">{decision.model}</span>
                  <span className="text-2xs text-muted-foreground">
                    {codeitlabProviderLabel(decision.providerInstanceId)} ·{" "}
                    {new Date(decision.decidedAt).toLocaleString()}
                  </span>
                  {isFallbackDecision(decision.reason) ? (
                    <Badge size="sm" variant="warning" data-route-fallback="true">
                      fallback
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{decision.reason}</p>
                {decision.omniRouteModel === undefined ? null : (
                  <Badge size="sm" variant="secondary">
                    via {decision.omniRouteModel}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CodeitlabCard>
    </div>
  );
}

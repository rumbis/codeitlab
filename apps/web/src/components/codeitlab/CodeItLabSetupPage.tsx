import { useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import type {
  SandboxBackendId,
  SandboxBackendStatus,
  SandboxHealth,
  SandboxHealthBackend,
  SandboxMachine,
  SandboxMachineState,
  SandboxRowState,
  SandboxRunResult,
  SandboxStatus,
} from "@codeitlab/contracts";
import { sandboxRunProblem } from "@codeitlab/core/sandbox";

import {
  useCodeItLabSandbox,
  useCodeItLabSandboxHealth,
  useSandboxMachineActions,
} from "../../codeitlab/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { CodeItLabCard, CodeItLabEmptyBlock, CodeItLabSectionHeading } from "./CodeItLabPrimitives";

type StateBadgeVariant = "success" | "warning" | "secondary" | "error";

const ROW_STATE: Readonly<
  Record<SandboxRowState, { readonly label: string; readonly variant: StateBadgeVariant }>
> = {
  available: { label: "available", variant: "success" },
  "not-installed": { label: "not installed", variant: "warning" },
  "needs-consent": { label: "needs consent", variant: "warning" },
  unsupported: { label: "unsupported", variant: "secondary" },
  unknown: { label: "unknown", variant: "error" },
};

const MACHINE_STATE: Readonly<
  Record<SandboxMachineState, { readonly label: string; readonly variant: StateBadgeVariant }>
> = {
  running: { label: "running", variant: "success" },
  stopped: { label: "stopped", variant: "warning" },
  missing: { label: "missing", variant: "secondary" },
  unsupported: { label: "unsupported", variant: "secondary" },
  unknown: { label: "unknown", variant: "error" },
};

const PLATFORM_LABELS: Readonly<Record<SandboxStatus["platform"], string>> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
  other: "this platform",
};

/**
 * The one sentence that answers "can I use a sandbox yet". It names the
 * recommended backend instead of a generic "not ready", because the user's next
 * action depends on which backend it is and what state it is in.
 */
function sandboxSummary(status: SandboxStatus): string {
  if (status.ready) return "Sandbox ready";
  const recommended =
    status.backends.find((backend) => backend.id === status.recommendedId) ?? null;
  if (recommended === null) return "No recommended backend for this platform yet.";
  switch (recommended.state) {
    case "available":
      return (
        recommended.label + " is available, but the server did not report the sandbox as ready."
      );
    case "needs-consent":
      return (
        recommended.label +
        " is recommended but not installed yet. Install it below to make the sandbox ready."
      );
    case "not-installed":
      return (
        recommended.label +
        " is recommended but not installed yet. Run its install command yourself to make the sandbox ready."
      );
    case "unknown":
      return (
        recommended.label +
        " is recommended but did not answer its version check, so the sandbox state is unknown."
      );
    case "unsupported":
      return recommended.label + " is recommended but not supported on this platform.";
  }
}

function SandboxBackendRow({
  row,
  confirming,
  installing,
  failure,
  onInstall,
  onCopy,
  onConfirm,
  onCancel,
}: {
  readonly row: SandboxBackendStatus;
  readonly confirming: boolean;
  readonly installing: boolean;
  readonly failure: { readonly outputTail: string } | null;
  readonly onInstall: () => void;
  readonly onCopy: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const state = ROW_STATE[row.state];
  const reasonId = "sandbox-reason-" + row.id;
  const confirmId = "sandbox-confirm-" + row.id;
  const installable = row.autoInstall && row.state !== "available";
  return (
    <li
      className="flex flex-col gap-2 px-4 py-4"
      data-sandbox-backend={row.id}
      data-sandbox-state={row.state}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{row.label}</p>
            {row.recommended ? (
              <Badge size="sm" variant="info">
                Recommended
              </Badge>
            ) : null}
            <Badge size="sm" variant={state.variant}>
              {state.label}
            </Badge>
            <span className="text-2xs uppercase tracking-wide text-muted-foreground">
              {PLATFORM_LABELS[row.platform]}
            </span>
            <span className="font-mono text-2xs tabular-nums text-muted-foreground">
              <span className="sr-only">Version </span>
              {row.version ?? "—"}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{row.summary}</p>
        </div>
        <div
          aria-describedby={row.reason === null ? undefined : reasonId}
          aria-label={row.label + " actions"}
          className="flex shrink-0 flex-wrap items-center gap-2"
          role="group"
        >
          {installable ? (
            <Button
              aria-busy={installing}
              aria-controls={confirming ? confirmId : undefined}
              aria-expanded={confirming}
              disabled={installing}
              size="sm"
              variant="outline"
              onClick={onInstall}
            >
              <DownloadIcon className="size-3.5" />
              {installing ? "Installing…" : "Install"}
            </Button>
          ) : null}
          {row.installCommand === null ? null : (
            <Button size="sm" variant="ghost" onClick={onCopy}>
              <CopyIcon className="size-3.5" />
              Copy command
            </Button>
          )}
          {row.docsUrl === null ? null : (
            <Button
              size="sm"
              variant="ghost"
              render={<a href={row.docsUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon className="size-3.5" />
              Docs
            </Button>
          )}
        </div>
      </div>
      {row.reason === null ? null : (
        <p className="text-xs text-muted-foreground" id={reasonId}>
          {row.reason}
        </p>
      )}
      {confirming ? (
        <div
          aria-label={"Confirm installing " + row.label}
          className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-3"
          id={confirmId}
          role="group"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onCancel();
          }}
        >
          <p className="text-xs text-foreground">
            This runs{" "}
            <code className="font-mono text-2xs text-codeitlab-cyan">{row.installCommand}</code> on
            this machine.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onConfirm}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {failure === null ? null : (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive-foreground">Install failed</p>
          {failure.outputTail.trim() === "" ? null : (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs tabular-nums text-muted-foreground">
              {failure.outputTail}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

function SandboxSkeletonRows() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2" data-sandbox-loading="">
      <span className="sr-only">Loading sandbox backends</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/40 px-4 py-4"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-7 w-44" shape="pill" />
        </div>
      ))}
    </div>
  );
}

function SandboxHealthBackendChecks({ backend }: { readonly backend: SandboxHealthBackend }) {
  return (
    <li className="flex flex-col gap-1.5" data-sandbox-health-backend={backend.id}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-foreground">{backend.label}</p>
        <Badge size="sm" variant={backend.healthy ? "success" : "error"}>
          {backend.healthy ? "ready" : "check failed"}
        </Badge>
      </div>
      <ul className="flex flex-col gap-1">
        {backend.checks.map((check) => (
          <li
            key={check.id}
            className="flex flex-col gap-0.5"
            data-sandbox-check={check.id}
            data-sandbox-check-ok={check.ok ? "true" : "false"}
          >
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {check.ok ? (
                <CheckIcon aria-hidden className="size-3.5 text-success-foreground" />
              ) : (
                <XIcon aria-hidden className="size-3.5 text-destructive-foreground" />
              )}
              <span className="sr-only">{check.ok ? "passed: " : "failed: "}</span>
              {check.label}
            </p>
            {check.ok || check.detail === null ? null : (
              <p className="ml-5 font-mono text-2xs text-muted-foreground">{check.detail}</p>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * The health half of the page. The sentence is the server's, verbatim: the page
 * has no way to know whether a daemon is reachable, so it never writes its own
 * ready claim.
 */
function SandboxHealthCard() {
  const sandboxHealth = useCodeItLabSandboxHealth();
  const probe = sandboxHealth.health;
  const health: SandboxHealth | null =
    probe === null ? null : probe._tag === "Success" ? probe.success : null;
  const healthError = probe !== null && probe._tag === "Failure" ? probe.failure : null;
  const available =
    health === null ? [] : health.backends.filter((backend) => backend.state === "available");
  const healthState =
    probe === null
      ? "loading"
      : healthError !== null
        ? "error"
        : health !== null && health.ready
          ? "ready"
          : "not-ready";
  const sentence =
    probe === null
      ? "Checking sandbox health…"
      : healthError !== null
        ? "The health check failed: " + healthError
        : health!.message;

  return (
    <CodeItLabCard data-codeitlab-sandbox-health="" data-sandbox-health-state={healthState}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <p className="codeitlab-mono-label text-codeitlab-green/80">Health</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">Sandbox ready</p>
        </div>
        {health === null ? null : (
          <Button
            aria-label="Check sandbox health again"
            size="sm"
            variant="outline"
            onClick={sandboxHealth.refresh}
          >
            <RefreshCwIcon className="size-3.5" />
            Check again
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-3 px-4 py-4">
        <p
          aria-live="polite"
          className="min-h-4 text-xs text-muted-foreground"
          data-sandbox-health-sentence=""
        >
          {sentence}
        </p>
        {probe === null ? (
          <div aria-busy="true" data-sandbox-health-loading="">
            <span className="sr-only">Loading sandbox health</span>
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        ) : null}
        {healthError === null ? null : (
          <div>
            <Button size="sm" variant="outline" onClick={sandboxHealth.refresh}>
              <RefreshCwIcon className="size-3.5" />
              Retry
            </Button>
          </div>
        )}
        {health === null ? null : available.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No backend is available yet. Install one from the matrix below and its checks appear
            here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {available.map((backend) => (
              <SandboxHealthBackendChecks key={backend.id} backend={backend} />
            ))}
          </ul>
        )}
      </div>
      {health === null ? null : (
        <SandboxMachineBlock machine={health.machine} onRefresh={sandboxHealth.refresh} />
      )}
    </CodeItLabCard>
  );
}

/**
 * The machine the app owns on the healthy backend. Create/remove are explicit
 * consent steps, and every sentence shown here comes from the server result.
 */
function SandboxMachineBlock({
  machine,
  onRefresh,
}: {
  readonly machine: SandboxMachine | null;
  readonly onRefresh: () => void;
}) {
  const actions = useSandboxMachineActions();
  const [confirming, setConfirming] = useState<"create" | "remove" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [outputTail, setOutputTail] = useState("");
  const [command, setCommand] = useState("uname -a");
  const [runResult, setRunResult] = useState<SandboxRunResult | null>(null);
  const runProblem =
    machine !== null && machine.state === "running" ? sandboxRunProblem({ command }) : null;

  if (machine === null) {
    return (
      <div
        className="border-t border-border/60 px-4 py-4"
        data-codeitlab-sandbox-machine=""
        data-sandbox-machine-state="none"
      >
        <p className="text-xs text-muted-foreground">No backend can own a machine here.</p>
      </div>
    );
  }

  const badge = MACHINE_STATE[machine.state];
  const pending = actions.pending;

  const create = async () => {
    setConfirming(null);
    setMessage(null);
    setOutputTail("");
    const result = await actions.create(machine.backend);
    if (result === null) return;
    setMessage(result.message);
    setOutputTail(result.outputTail);
    onRefresh();
  };

  const remove = async () => {
    setConfirming(null);
    setMessage(null);
    setOutputTail("");
    setRunResult(null);
    const result = await actions.remove();
    if (result === null) return;
    setMessage(result.message);
    setOutputTail(result.outputTail);
    onRefresh();
  };

  const start = async () => {
    setMessage(null);
    setOutputTail("");
    setRunResult(null);
    const result = await actions.start(machine.backend);
    if (result === null) return;
    setMessage(result.message);
    setOutputTail(result.outputTail);
    onRefresh();
  };

  const stop = async () => {
    setMessage(null);
    setOutputTail("");
    setRunResult(null);
    const result = await actions.stop();
    if (result === null) return;
    setMessage(result.message);
    setOutputTail(result.outputTail);
    onRefresh();
  };

  const run = async () => {
    if (runProblem !== null) return;
    setRunResult(null);
    const result = await actions.run(command);
    if (result === null) return;
    setRunResult(result);
  };

  return (
    <div
      className="flex flex-col gap-3 border-t border-border/60 px-4 py-4"
      data-codeitlab-sandbox-machine=""
      data-sandbox-machine-state={machine.state}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || confirming === null) return;
        event.preventDefault();
        setConfirming(null);
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Machine</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{machine.name}</p>
            <Badge size="sm" variant={badge.variant}>
              {badge.label}
            </Badge>
            <span className="font-mono text-2xs tabular-nums text-muted-foreground">
              {machine.image ?? "—"}
            </span>
          </div>
          {machine.detail === null || machine.state === "stopped" ? null : (
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{machine.detail}</p>
          )}
        </div>
        <div
          className="flex shrink-0 flex-wrap items-center gap-2"
          role="group"
          aria-label="Sandbox machine actions"
        >
          {machine.state === "missing" ? (
            <Button
              aria-busy={pending === "create"}
              disabled={pending !== null}
              size="sm"
              variant="outline"
              onClick={() => {
                setMessage(null);
                setConfirming("create");
              }}
            >
              <PlusIcon className="size-3.5" />
              Create
            </Button>
          ) : null}
          {machine.state === "stopped" ? (
            <Button
              aria-busy={pending === "start"}
              disabled={pending !== null}
              size="sm"
              variant="outline"
              onClick={() => void start()}
            >
              <PlayIcon className="size-3.5" />
              Start
            </Button>
          ) : null}
          {machine.state === "running" ? (
            <Button
              aria-busy={pending === "stop"}
              disabled={pending !== null}
              size="sm"
              variant="outline"
              onClick={() => void stop()}
            >
              <SquareIcon className="size-3.5" />
              Stop
            </Button>
          ) : null}
          {machine.state === "running" || machine.state === "stopped" ? (
            <Button
              aria-busy={pending === "remove"}
              disabled={pending !== null}
              size="sm"
              variant="outline"
              onClick={() => {
                setMessage(null);
                setConfirming("remove");
              }}
            >
              <Trash2Icon className="size-3.5" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <p
        aria-live="polite"
        className="min-h-4 text-xs text-muted-foreground"
        data-sandbox-machine-message=""
      >
        {message ?? actions.error ?? ""}
      </p>

      {confirming === "create" ? (
        <div
          aria-label="Confirm creating the sandbox machine"
          className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-3"
          role="group"
        >
          <p className="text-xs text-foreground">
            This may download the image{" "}
            <code className="font-mono text-2xs text-codeitlab-cyan">
              {machine.image ?? "for this backend"}
            </code>
            .
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending !== null} onClick={() => void create()}>
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {confirming === "remove" ? (
        <div
          aria-label="Confirm removing the sandbox machine"
          className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-3"
          role="group"
        >
          <p className="text-xs text-foreground">
            This deletes{" "}
            <code className="font-mono text-2xs text-codeitlab-cyan">{machine.name}</code>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending !== null} onClick={() => void remove()}>
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {outputTail.trim() === "" ? null : (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs tabular-nums text-muted-foreground">
          {outputTail}
        </pre>
      )}

      {machine.state === "running" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1" htmlFor="sandbox-machine-command">
              <span className="text-xs font-medium text-foreground">
                Command to run in the sandbox
              </span>
              <Input
                aria-describedby={runProblem === null ? undefined : "sandbox-machine-run-reason"}
                font="mono"
                id="sandbox-machine-command"
                size="sm"
                value={command}
                onChange={(event) => setCommand(event.currentTarget.value)}
              />
            </label>
            <Button
              aria-busy={pending === "run"}
              aria-describedby={runProblem === null ? undefined : "sandbox-machine-run-reason"}
              disabled={pending !== null || runProblem !== null}
              size="sm"
              onClick={() => void run()}
            >
              <PlayIcon className="size-3.5" />
              {pending === "run" ? "Running…" : "Run"}
            </Button>
          </div>
          {runProblem === null ? null : (
            <p className="text-xs text-muted-foreground" id="sandbox-machine-run-reason">
              {runProblem}
            </p>
          )}
          {runResult === null ? null : (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">{runResult.message}</p>
              <p className="font-mono text-2xs tabular-nums text-muted-foreground">
                Exit {runResult.exitCode} · {runResult.durationMs} ms
              </p>
              {runResult.stdout.trim() === "" ? null : (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs">
                  {runResult.stdout}
                </pre>
              )}
              {runResult.stderr.trim() === "" ? null : (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs text-destructive-foreground">
                  {runResult.stderr}
                </pre>
              )}
            </div>
          )}
        </div>
      ) : null}

      {machine.state === "stopped" ? (
        <div className="flex flex-col gap-1">
          {machine.detail === null ? null : (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-2xs text-muted-foreground">
              {machine.detail}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CodeItLabSetupPage() {
  const sandbox = useCodeItLabSandbox();
  const [statusOverride, setStatusOverride] = useState<SandboxStatus | null>(null);
  const [confirmingId, setConfirmingId] = useState<SandboxBackendId | null>(null);
  const [installingId, setInstallingId] = useState<SandboxBackendId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    readonly backend: SandboxBackendId;
    readonly outputTail: string;
  } | null>(null);

  const probe = sandbox.status;
  const status =
    statusOverride ?? (probe === null ? null : probe._tag === "Success" ? probe.success : null);
  const probeError =
    statusOverride === null && probe !== null && probe._tag === "Failure" ? probe.failure : null;
  const summary = status === null ? null : sandboxSummary(status);
  const liveText =
    message ??
    (probeError === null
      ? (summary ?? "Checking sandbox backends…")
      : "Sandbox probe failed: " + probeError);

  const refresh = () => {
    setMessage(null);
    sandbox.refresh();
  };

  const copyCommand = async (row: SandboxBackendStatus) => {
    if (row.installCommand === null) return;
    try {
      await navigator.clipboard.writeText(row.installCommand);
      setMessage("Copied " + row.label + " install command.");
    } catch {
      setMessage(
        "Could not copy the " +
          row.label +
          " install command. Select the command and copy it manually.",
      );
    }
  };

  const install = async (row: SandboxBackendStatus) => {
    setConfirmingId(null);
    setInstallingId(row.id);
    setMessage("Installing " + row.label + "…");
    const result = await sandbox.install({ backend: row.id, consent: true });
    setInstallingId(null);
    if (result === null) {
      setMessage("Install did not run. Check that an environment is connected and try again.");
      return;
    }
    // The install result already carries the post-install probe, so the row can
    // flip now instead of waiting for a second round trip.
    setStatusOverride(result.status);
    if (result.ok) {
      setFailure(null);
      setMessage(null);
      return;
    }
    setFailure({ backend: row.id, outputTail: result.outputTail });
    setMessage("Install failed: " + result.message);
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="setup">
      <CodeItLabSectionHeading
        eyebrow="Setup"
        title="Sandbox backends"
        description="What this machine can run for isolated agent work. The server probes each backend's CLI; this page reports what answered and never guesses."
        action={
          status === null && probeError === null ? undefined : (
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCwIcon className="size-3.5" />
              Check again
            </Button>
          )
        }
      />
      <p
        aria-live="polite"
        className="min-h-5 text-xs text-muted-foreground"
        data-sandbox-status=""
        id="sandbox-live"
        role="status"
      >
        {liveText}
      </p>

      <SandboxHealthCard />

      {status === null && probeError === null ? <SandboxSkeletonRows /> : null}

      {probeError === null ? null : (
        <CodeItLabCard>
          <div className="flex flex-col gap-2 px-4 py-4">
            <p className="text-sm font-medium text-foreground">The sandbox probe failed</p>
            <p className="text-xs text-muted-foreground">
              The server did not answer the sandbox check: {probeError}
            </p>
            <p className="text-xs text-muted-foreground">
              No backend rows are shown, so there is nothing to install from here. Copy commands
              stay copy-only by design and come back with the matrix; retrying the probe is safe.
            </p>
            <div>
              <Button size="sm" variant="outline" onClick={refresh}>
                <RefreshCwIcon className="size-3.5" />
                Retry probe
              </Button>
            </div>
          </div>
        </CodeItLabCard>
      )}

      {status === null ? null : (
        <>
          {status.notes.length === 0 ? null : (
            <ul className="flex flex-col gap-1" data-sandbox-notes="">
              {status.notes.map((note) => (
                <li key={note} className="text-xs text-warning-foreground">
                  {note}
                </li>
              ))}
            </ul>
          )}
          {status.backends.length === 0 ? (
            <CodeItLabEmptyBlock
              title="No sandbox backends reported"
              description="The server answered but listed no backends. Probe again; this page only renders what the server reports."
              action={
                <Button size="sm" variant="outline" onClick={refresh}>
                  <RefreshCwIcon className="size-3.5" />
                  Probe again
                </Button>
              }
            />
          ) : (
            <CodeItLabCard>
              <div className="border-b border-border/60 px-4 py-3">
                <p className="codeitlab-mono-label text-codeitlab-green/80">Matrix</p>
                <p className="mt-0.5 text-sm font-medium text-foreground">
                  Backends on this machine
                </p>
              </div>
              <ul className="divide-y divide-border/50">
                {status.backends.map((row) => (
                  <SandboxBackendRow
                    key={row.id}
                    confirming={confirmingId === row.id}
                    failure={failure?.backend === row.id ? failure : null}
                    installing={installingId === row.id}
                    row={row}
                    onCancel={() => setConfirmingId(null)}
                    onConfirm={() => void install(row)}
                    onCopy={() => void copyCommand(row)}
                    onInstall={() => {
                      setMessage(null);
                      setConfirmingId(row.id);
                    }}
                  />
                ))}
              </ul>
            </CodeItLabCard>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Installing is a machine-level change. This page runs only the commands the server marks
        installable, after you confirm; every other command is copy-only. No VM image is downloaded
        by this page.
      </p>
    </div>
  );
}

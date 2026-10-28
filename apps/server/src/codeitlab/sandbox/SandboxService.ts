import { CodeItLabServiceError } from "@codeitlab/core";
import {
  SANDBOX_COMMAND_TIMEOUT_DEFAULT_MS,
  SANDBOX_MACHINE_NAME,
  SANDBOX_READINESS_CHECKS,
  SANDBOX_RUN_OUTPUT_LIMIT,
  SANDBOX_SYNC_DIR,
  SANDBOX_SYNC_TIMEOUT_MS,
  normalizeSandboxPlatform,
  sandboxBackend,
  sandboxHealthBackendMessage,
  sandboxHealthMessage,
  sandboxMachineBackend,
  sandboxMachineImage,
  sandboxReadinessResult,
  sandboxReady,
  sandboxRecommendedBackend,
  sandboxRowReason,
  sandboxRowsForPlatform,
  sandboxRowState,
  sandboxRunProblem,
  sandboxSyncProblem,
  type SandboxBackendId,
  type SandboxBackendStatus,
  type SandboxCheck,
  type SandboxHealth,
  type SandboxHealthBackend,
  type SandboxHostPlatform,
  type SandboxInstallInput,
  type SandboxInstallResult,
  type SandboxMachine,
  type SandboxMachineCreateInput,
  type SandboxMachineCreateResult,
  type SandboxMachineRemoveInput,
  type SandboxMachineRemoveResult,
  type SandboxMachineStartInput,
  type SandboxMachineStartResult,
  type SandboxMachineStopInput,
  type SandboxMachineStopResult,
  type SandboxMachineState,
  type SandboxRow,
  type SandboxRowState,
  type SandboxRunInput,
  type SandboxRunResult,
  type SandboxStatus,
  type SandboxSyncInput,
  type SandboxSyncResult,
} from "@codeitlab/core/sandbox";
import { SandboxService as SandboxServiceTag } from "@codeitlab/core/services";
import * as HostProcess from "@codeitlab/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../../processRunner.ts";

/**
 * The sandbox backends this machine can actually run, and the one install the
 * app is allowed to perform.
 *
 * The matrix (what runs where, what may be installed from here) lives in
 * `@codeitlab/core/sandbox`; this service only turns it into facts by asking
 * each CLI. Every host call goes through `SandboxCommandRunner`, which is why a
 * test can exercise install without ever running one.
 */

const PROBE_TIMEOUT_MS = 5_000;
/** Homebrew downloads a bottle and links it; a slow network should not kill it. */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1_000;
/** Per-stream cap in the runner; the tail below is what actually crosses the wire. */
const MAX_OUTPUT_BYTES = 64 * 1024;
const OUTPUT_TAIL_LIMIT = 4_000;
const VERSION_LIMIT = 120;
const PROBE_DETAIL_LIMIT = 200;
const HOMEBREW_MISSING_NOTE = "Homebrew is not installed, so Tart cannot be installed from here.";
/** Probing a machine is a list/inspect call, not a boot. */
const MACHINE_PROBE_TIMEOUT_MS = 5_000;
/** A clone or a container start may need to unpack an image. */
const MACHINE_CREATE_TIMEOUT_MS = 10 * 60 * 1_000;
const MACHINE_REMOVE_TIMEOUT_MS = 2 * 60 * 1_000;
const MACHINE_START_TIMEOUT_MS = 30 * 1_000;
const MACHINE_STOP_TIMEOUT_MS = 2 * 60 * 1_000;
/** A VM boot is seconds: each attempt is a real `tart list`, so no timer is added. */
const MACHINE_START_POLL_ATTEMPTS = 20;
const MISSING_MACHINE_PATTERN = /no such (object|container)|not found|does not exist|no container/i;
const MISSING_IMAGE_PATTERN = /not found|no such|unable to find|failed to find|does not exist/i;

export interface SandboxCommandInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly timeoutMs: number;
  /** Text piped to the command's stdin; a sync ships its archive this way. */
  readonly stdin?: string | undefined;
}

export interface SandboxCommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The only door to the host. It never fails: a missing binary is an answer
 * ("not installed"), not an exception, and an injected fake is what keeps tests
 * from spawning anything.
 */
export class SandboxCommandRunner extends Context.Service<
  SandboxCommandRunner,
  {
    readonly run: (input: SandboxCommandInput) => Effect.Effect<SandboxCommandOutput>;
  }
>()("rumbis/codeitlab/sandbox/SandboxService/SandboxCommandRunner") {}

// CSI escape sequences: the colors and cursor moves brew/apt/curl emit.
// eslint-disable-next-line no-control-regex -- ANSI sequences begin with ESC.
const ANSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex -- Removing control bytes is the point.
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// Install logs can echo the environment they inherited, and a token-shaped
// assignment must never come back over the wire.
const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)[A-Za-z0-9_]*)\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s]+)/gi;

const sanitizeText = (text: string): string =>
  text
    .replace(ANSI_PATTERN, "")
    .replace(CONTROL_PATTERN, "")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[redacted]");

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : text.slice(0, limit);

const firstLine = (text: string, limit: number): string | null => {
  for (const line of sanitizeText(text).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return truncate(trimmed, limit);
  }
  return null;
};

/** The last lines of an install log, ANSI-free and bounded. */
const sanitizeOutputTail = (text: string): string => {
  const cleaned = sanitizeText(text).trim();
  return cleaned.length <= OUTPUT_TAIL_LIMIT ? cleaned : cleaned.slice(-OUTPUT_TAIL_LIMIT);
};

/** Command output keeps its tail: the end of a build log is the useful part. */
const sanitizeRunOutput = (text: string): string => {
  const cleaned = sanitizeText(text);
  return cleaned.length <= SANDBOX_RUN_OUTPUT_LIMIT
    ? cleaned
    : cleaned.slice(-SANDBOX_RUN_OUTPUT_LIMIT);
};

/**
 * `tart list --format json` prints an array of objects. The field names have
 * been stable but the app only needs name + state, so an unexpected shape is
 * reported as "unknown" instead of guessed.
 */
const parseTartList = (
  text: string,
): ReadonlyArray<{ readonly name: string; readonly running: boolean }> | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const entries: Array<{ name: string; running: boolean }> = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name =
      typeof record.Name === "string"
        ? record.Name
        : typeof record.name === "string"
          ? record.name
          : null;
    if (name === null) continue;
    const state =
      typeof record.State === "string"
        ? record.State
        : typeof record.state === "string"
          ? record.state
          : "";
    entries.push({ name, running: state.toLowerCase() === "running" });
  }
  return entries;
};

const MISSING_COMMAND_PATTERN = /ENOENT|not found|no such file|command not found/i;

const isMissingCommand = (output: SandboxCommandOutput): boolean => {
  if (output.exitCode === 0) return false;
  // 127 is the POSIX shell's "command not found"; 9009 is cmd.exe's.
  if (output.exitCode === 127 || output.exitCode === 9009) return true;
  return MISSING_COMMAND_PATTERN.test(`${output.stderr}\n${output.stdout}`);
};

const spawnFailureText = (command: string, error: ProcessRunner.ProcessRunError): string => {
  if (error._tag === "ProcessSpawnError") {
    const cause = error.cause as
      | { readonly _tag?: unknown; readonly reason?: { readonly _tag?: unknown } }
      | undefined;
    if (cause?._tag === "PlatformError" && cause.reason?._tag === "NotFound") {
      return `ENOENT: ${command} was not found on PATH.`;
    }
  }
  return `Failed to run ${command}: ${error.message}`;
};

const makeCommandRunner = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const run: SandboxCommandRunner["Service"]["run"] = (input) =>
    processRunner
      .run({
        command: input.command,
        args: input.args,
        stdin: input.stdin,
        timeout: Duration.millis(input.timeoutMs),
        timeoutBehavior: "timedOutResult",
        outputMode: "truncate",
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })
      .pipe(
        Effect.map((output) => ({
          exitCode: output.timedOut ? -1 : (output.code ?? -1),
          stdout: output.stdout,
          stderr:
            output.timedOut && output.stderr.trim().length === 0
              ? `The command did not answer within ${input.timeoutMs}ms.`
              : output.stderr,
        })),
        Effect.catch((error) =>
          Effect.succeed({
            exitCode: -1,
            stdout: "",
            stderr: spawnFailureText(input.command, error),
          }),
        ),
      );

  return SandboxCommandRunner.of({ run });
});

export const commandRunnerLayer = Layer.effect(SandboxCommandRunner, makeCommandRunner);

export interface SandboxServiceDeps {
  readonly runner: SandboxCommandRunner["Service"];
  readonly platform: string;
  readonly arch: string;
}

interface BackendProbe {
  readonly row: SandboxRow;
  readonly state: SandboxRowState;
  readonly version: string | null;
  readonly detail: string | null;
}

const installError = (message: string, cause?: unknown): CodeItLabServiceError =>
  new CodeItLabServiceError({
    operation: "sandbox.install",
    message,
    ...(cause === undefined ? {} : { cause }),
  });

// The wire schema types consent as the literal `true`; this keeps a caller that
// skipped decoding (or cast the input) from installing without asking.
const hasConsent = (input: { readonly consent?: unknown }): boolean => input.consent === true;

/**
 * Auto-install commands are one executable plus arguments ("brew install
 * cirruslabs/cli/tart"). Manual commands may contain pipes or `sudo` and are
 * never executed, so they never reach this split.
 */
const installArgv = (
  command: string,
): { readonly command: string; readonly args: ReadonlyArray<string> } => {
  const [executable = command, ...args] = command.trim().split(/\s+/);
  return { command: executable, args };
};

/** Single-quote a value for `sh -c`: the cwd is a thread path, not shell syntax. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

const parseTrackedFiles = (stdout: string): number => {
  const trimmed = stdout.trim();
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : 0;
};

/**
 * The copy is one shell command inside the machine: make the directory, then
 * unpack the tar that arrives on stdin. Only tracked files move — `git archive
 * HEAD` skips everything gitignored, so a `.env` stays on the host — and
 * nothing is ever copied back out.
 */
const SYNC_SCRIPT = `mkdir -p ${SANDBOX_SYNC_DIR} && cd ${SANDBOX_SYNC_DIR} && base64 -d | tar -xf -`;

export const makeSandboxService = (deps: SandboxServiceDeps): SandboxServiceTag["Service"] => {
  const { runner } = deps;

  // One probe per backend row, under the status span; a span per row would only
  // repeat the parent.
  const probeRow = Effect.fnUntraced(function* (row: SandboxRow): Effect.fn.Return<BackendProbe> {
    if (!row.supported) {
      return { row, state: "unsupported", version: null, detail: null };
    }
    const [command = row.backend.id, ...args] = row.backend.versionArgs;
    const output = yield* runner.run({ command, args, timeoutMs: PROBE_TIMEOUT_MS });
    const installed = output.exitCode === 0;
    const probeFailed = !installed && !isMissingCommand(output);
    const state = sandboxRowState({
      supported: true,
      installed,
      probeFailed,
      autoInstall: row.autoInstall,
    });
    return {
      row,
      state,
      version: installed
        ? (firstLine(output.stdout, VERSION_LIMIT) ?? firstLine(output.stderr, VERSION_LIMIT))
        : null,
      detail:
        state === "unknown"
          ? firstLine(`${output.stderr}\n${output.stdout}`, PROBE_DETAIL_LIMIT)
          : null,
    };
  });

  const readStatus = Effect.fn("SandboxService.status")(function* () {
    const platform = normalizeSandboxPlatform(deps.platform);
    const rows = sandboxRowsForPlatform(platform);
    const probes = yield* Effect.forEach(rows, probeRow, { concurrency: "unbounded" });

    const states: Partial<Record<SandboxBackendId, SandboxRowState>> = {};
    for (const probe of probes) states[probe.row.backend.id] = probe.state;

    const backends = probes.map((probe): SandboxBackendStatus => ({
      id: probe.row.backend.id,
      label: probe.row.backend.label,
      summary: probe.row.backend.summary,
      platform,
      state: probe.state,
      version: probe.version,
      installCommand: probe.row.installCommand,
      autoInstall: probe.row.autoInstall,
      installNote: probe.row.backend.installNote,
      reason: sandboxRowReason(probe.state, probe.row, probe.detail),
      recommended: probe.row.recommended,
      docsUrl: probe.row.backend.docsUrl,
    }));

    const notes: string[] = [];
    const tart = probes.find((probe) => probe.row.backend.id === "tart");
    // Only matters while Tart still needs installing; once it answers, how it
    // got here is history.
    if (platform === "darwin" && tart !== undefined && tart.state !== "available") {
      const brew = yield* runner.run({
        command: "brew",
        args: ["--version"],
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (brew.exitCode !== 0) notes.push(HOMEBREW_MISSING_NOTE);
    }

    return {
      platform,
      arch: deps.arch,
      checkedAt: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
      backends,
      recommendedId: sandboxRecommendedBackend(platform),
      ready: sandboxReady(platform, states),
      installAvailable: rows.some((row) => row.autoInstall),
      notes,
    } satisfies SandboxStatus;
  });

  const status: SandboxServiceTag["Service"]["status"] = readStatus();

  const install: SandboxServiceTag["Service"]["install"] = Effect.fn("SandboxService.install")(
    function* (input: SandboxInstallInput) {
      if (!hasConsent(input)) {
        return yield* installError(
          "Installing a sandbox backend changes this machine, so it needs explicit consent.",
        );
      }

      const platform = normalizeSandboxPlatform(deps.platform);
      const row = sandboxRowsForPlatform(platform).find(
        (candidate) => candidate.backend.id === input.backend,
      );
      if (row === undefined) {
        return yield* installError(`Unknown sandbox backend: ${input.backend}.`);
      }
      const label = row.backend.label;
      if (!row.supported) {
        return yield* installError(
          `${label} cannot run on this platform. ${row.unsupportedReason ?? ""}`.trim(),
        );
      }
      if (row.installCommand === null) {
        return yield* installError(
          `${label} has no known install command on this platform, so it has to be installed by hand.`,
        );
      }
      if (!row.autoInstall) {
        return yield* installError(
          `${label} cannot be installed from the app: the install needs administrator rights, a reboot, or a GUI. Run \`${row.installCommand}\` yourself.`,
        );
      }

      const argv = installArgv(row.installCommand);
      const output = yield* runner.run({ ...argv, timeoutMs: INSTALL_TIMEOUT_MS });
      const next = yield* readStatus();
      const after = next.backends.find((entry) => entry.id === input.backend)?.state;
      const ok = output.exitCode === 0 && after === "available";
      const message = ok
        ? `${label} is installed.`
        : output.exitCode !== 0
          ? `${label} install exited with code ${output.exitCode}.`
          : `${label} install finished, but ${label} still does not answer its version check.`;

      return {
        backend: input.backend,
        ok,
        message,
        outputTail: sanitizeOutputTail(`${output.stdout}\n${output.stderr}`),
        status: next,
      } satisfies SandboxInstallResult;
    },
  );

  /**
   * One probe, two checks: the version command decides whether the backend is
   * installed, and the readiness command asks the question the version cannot —
   * does the daemon answer, can it list VMs, does WSL know a distribution. The
   * readiness check only runs when the version check passed: a missing binary
   * is "not installed", not a second failure to explain.
   */
  const checkRow = Effect.fnUntraced(function* (
    row: SandboxRow,
  ): Effect.fn.Return<SandboxHealthBackend> {
    if (!row.supported) {
      return {
        id: row.backend.id,
        label: row.backend.label,
        state: "unsupported",
        recommended: row.recommended,
        healthy: false,
        checks: [],
        message: sandboxHealthBackendMessage({
          label: row.backend.label,
          state: "unsupported",
          checks: [],
        }),
      } satisfies SandboxHealthBackend;
    }

    const [versionCommand = row.backend.id, ...versionArgs] = row.backend.versionArgs;
    const versionOutput = yield* runner.run({
      command: versionCommand,
      args: versionArgs,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const installed = versionOutput.exitCode === 0;
    const probeFailed = !installed && !isMissingCommand(versionOutput);
    const state = sandboxRowState({
      supported: true,
      installed,
      probeFailed,
      autoInstall: row.autoInstall,
    });
    const checks: Array<SandboxCheck> = [
      {
        id: "version",
        label: "Version check",
        ok: installed,
        detail: installed
          ? null
          : firstLine(`${versionOutput.stderr}\n${versionOutput.stdout}`, PROBE_DETAIL_LIMIT),
      },
    ];

    const readiness = SANDBOX_READINESS_CHECKS[row.backend.id];
    if (installed && readiness !== undefined) {
      // Same executable as the version check: WSL's binary is `wsl`, not its
      // backend id, and a backend whose CLI name differs must not be special-cased.
      const readinessOutput = yield* runner.run({
        command: versionCommand,
        args: readiness.argv,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      // The verdict is the core's job: WSL succeeds on a machine with no
      // distribution, and only the distribution can run work.
      const verdict = sandboxReadinessResult(readiness, {
        exitCode: readinessOutput.exitCode,
        stdout: readinessOutput.stdout,
        stderr: readinessOutput.stderr,
      });
      checks.push({
        id: readiness.id,
        label: readiness.label,
        ok: verdict.ok,
        // The core reads the answer; redaction stays here, where every other
        // detail from this machine is sanitized before it crosses the wire.
        detail: verdict.ok ? null : firstLine(verdict.detail ?? "", PROBE_DETAIL_LIMIT),
      });
    }

    return {
      id: row.backend.id,
      label: row.backend.label,
      state,
      recommended: row.recommended,
      healthy: state === "available" && checks.every((check) => check.ok),
      checks,
      message: sandboxHealthBackendMessage({ label: row.backend.label, state, checks }),
    } satisfies SandboxHealthBackend;
  });

  const health: SandboxServiceTag["Service"]["health"] = Effect.gen(function* () {
    const platform = normalizeSandboxPlatform(deps.platform);
    const backends = yield* Effect.forEach(sandboxRowsForPlatform(platform), checkRow, {
      concurrency: "unbounded",
    });
    const healthy =
      backends.find((backend) => backend.healthy && backend.recommended) ??
      backends.find((backend) => backend.healthy);
    // One machine at a time: the ready backend owns it, or the first installed
    // backend if nothing is ready yet.
    const machineBackend =
      healthy?.id ?? backends.find((backend) => backend.state === "available")?.id ?? null;
    return {
      platform,
      arch: deps.arch,
      checkedAt: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
      backends,
      readyId: healthy?.id ?? null,
      ready: healthy !== undefined,
      message: sandboxHealthMessage(backends),
      machine: machineBackend === null ? null : yield* readMachine(machineBackend),
    } satisfies SandboxHealth;
  }).pipe(Effect.withSpan("SandboxService.health"));

  // One machine per backend with a stable name. Containers are created detached;
  // Tart is cloned first and started later, because `tart run` is a foreground
  // process: the app backgrounds it and then believes `tart list`, never the
  // spawn. Starting and stopping are explicit, consented steps for both kinds.
  const machineCapableBackends = (platform: SandboxHostPlatform): ReadonlyArray<SandboxRow> =>
    sandboxRowsForPlatform(platform).filter(
      (row) => row.supported && sandboxMachineBackend(row.backend.id),
    );

  const machineOf = (
    backend: SandboxBackendId,
    state: SandboxMachineState,
    detail: string | null,
  ): SandboxMachine => ({
    backend,
    name: SANDBOX_MACHINE_NAME,
    image: sandboxMachineImage(backend),
    state,
    detail,
  });

  const machineError = (message: string, operation = "sandbox.machine"): CodeItLabServiceError =>
    new CodeItLabServiceError({ operation, message });

  const readMachine = Effect.fnUntraced(function* (
    backend: SandboxBackendId,
  ): Effect.fn.Return<SandboxMachine> {
    if (!sandboxMachineBackend(backend)) {
      return machineOf(
        backend,
        "unsupported",
        "WSL2 is the prerequisite for containers, not a machine of its own.",
      );
    }
    if (backend === "tart") {
      const output = yield* runner.run({
        command: "tart",
        args: ["list", "--format", "json"],
        timeoutMs: MACHINE_PROBE_TIMEOUT_MS,
      });
      if (output.exitCode !== 0) {
        return machineOf(
          backend,
          "unknown",
          firstLine(`${output.stderr}\n${output.stdout}`, PROBE_DETAIL_LIMIT),
        );
      }
      const entries = parseTartList(output.stdout);
      if (entries === null) {
        return machineOf(backend, "unknown", "tart list did not print JSON this app understands.");
      }
      const entry = entries.find((candidate) => candidate.name === SANDBOX_MACHINE_NAME);
      if (entry === undefined) return machineOf(backend, "missing", null);
      return machineOf(backend, entry.running ? "running" : "stopped", null);
    }
    const output = yield* runner.run({
      command: backend,
      args: ["inspect", "--format", "{{.State.Status}}", SANDBOX_MACHINE_NAME],
      timeoutMs: MACHINE_PROBE_TIMEOUT_MS,
    });
    if (output.exitCode !== 0) {
      const text = `${output.stderr}\n${output.stdout}`;
      if (MISSING_MACHINE_PATTERN.test(text)) return machineOf(backend, "missing", null);
      return machineOf(backend, "unknown", firstLine(text, PROBE_DETAIL_LIMIT));
    }
    const state = output.stdout.trim().toLowerCase();
    return machineOf(
      backend,
      state === "running" ? "running" : "stopped",
      state === "running" ? null : firstLine(state, PROBE_DETAIL_LIMIT),
    );
  });

  /**
   * The machine a run or a sync talks to: the first one that is running. A
   * stopped machine is named with the command that starts it, and the app never
   * starts it on its own — that is a consented step.
   */
  const requireRunningMachine = Effect.fnUntraced(function* (
    operation: string,
  ): Effect.fn.Return<SandboxMachine, CodeItLabServiceError> {
    const platform = normalizeSandboxPlatform(deps.platform);
    let stopped: SandboxMachine | null = null;
    for (const row of machineCapableBackends(platform)) {
      const machine = yield* readMachine(row.backend.id);
      if (machine.state === "running") return machine;
      if (machine.state === "stopped" && stopped === null) stopped = machine;
    }
    return yield* machineError(
      stopped === null
        ? "There is no sandbox machine yet. Create one in Setup first."
        : `The ${sandboxBackend(stopped.backend).label} machine is stopped. Start it in Setup (or press Start on the machine card), or run \`${
            stopped.backend === "tart"
              ? `tart run ${SANDBOX_MACHINE_NAME} --no-graphics`
              : `${stopped.backend} start ${SANDBOX_MACHINE_NAME}`
          }\`; commands only run inside a running machine.`,
      operation,
    );
  });

  const machineCreate: SandboxServiceTag["Service"]["machineCreate"] = Effect.fn(
    "SandboxService.machineCreate",
  )(function* (input: SandboxMachineCreateInput) {
    if (!hasConsent(input)) {
      return yield* machineError(
        "Creating a sandbox machine changes this machine, so it needs explicit consent.",
      );
    }
    const platform = normalizeSandboxPlatform(deps.platform);
    const row = sandboxRowsForPlatform(platform).find(
      (candidate) => candidate.backend.id === input.backend,
    );
    if (row === undefined) {
      return yield* machineError(`Unknown sandbox backend: ${input.backend}.`);
    }
    const label = row.backend.label;
    if (!row.supported) {
      return yield* machineError(
        `${label} cannot run on this platform. ${row.unsupportedReason ?? ""}`.trim(),
      );
    }
    const image = sandboxMachineImage(input.backend);
    if (image === null) {
      return yield* machineError(
        "WSL2 is the prerequisite for containers, not a machine of its own. Create a Docker or Podman machine instead.",
      );
    }
    const status = yield* readStatus();
    const state = status.backends.find((entry) => entry.id === input.backend)?.state;
    if (state !== "available") {
      return yield* machineError(
        `${label} is not installed on this machine yet, so it cannot create a sandbox. Install it in Setup first.`,
      );
    }

    const existing = yield* readMachine(input.backend);
    if (existing.state !== "missing") {
      return {
        ok: true,
        machine: existing,
        message:
          existing.state === "running"
            ? "The sandbox machine is already running."
            : "The sandbox machine already exists.",
        outputTail: "",
      } satisfies SandboxMachineCreateResult;
    }

    const output =
      input.backend === "tart"
        ? yield* runner.run({
            command: "tart",
            args: ["clone", image, SANDBOX_MACHINE_NAME],
            timeoutMs: MACHINE_CREATE_TIMEOUT_MS,
          })
        : yield* runner.run({
            command: input.backend,
            args: ["run", "-d", "--name", SANDBOX_MACHINE_NAME, image, "sleep", "infinity"],
            timeoutMs: MACHINE_CREATE_TIMEOUT_MS,
          });
    const machine = yield* readMachine(input.backend);
    const outputTail = sanitizeOutputTail(`${output.stdout}\n${output.stderr}`);

    if (input.backend === "tart") {
      if (output.exitCode !== 0) {
        const text = `${output.stderr}\n${output.stdout}`;
        const missingImage = MISSING_IMAGE_PATTERN.test(text);
        return {
          ok: false,
          machine,
          message: missingImage
            ? `The Tart image ${image} is not on this machine. Run \`tart pull ${image}\` first; the app does not download VM images.`
            : `tart clone exited with code ${output.exitCode}.`,
          outputTail,
        } satisfies SandboxMachineCreateResult;
      }
      return {
        ok: machine.state === "stopped",
        machine,
        message: `Created the Tart VM ${SANDBOX_MACHINE_NAME}. Start it from Setup (the app backgrounds \`tart run\` and then checks \`tart list\`).`,
        outputTail,
      } satisfies SandboxMachineCreateResult;
    }

    const ok = output.exitCode === 0 && machine.state === "running";
    return {
      ok,
      machine,
      message: ok
        ? `Created and started the container ${SANDBOX_MACHINE_NAME}.`
        : output.exitCode !== 0
          ? `${input.backend} run exited with code ${output.exitCode}.`
          : `The container was created but is ${machine.state}.`,
      outputTail,
    } satisfies SandboxMachineCreateResult;
  });

  const waitForRunning = (
    backend: SandboxBackendId,
    attempts: number,
  ): Effect.Effect<SandboxMachine> =>
    readMachine(backend).pipe(
      Effect.flatMap((machine) =>
        machine.state === "running" || attempts <= 1
          ? Effect.succeed(machine)
          : waitForRunning(backend, attempts - 1),
      ),
    );

  const machineStart: SandboxServiceTag["Service"]["machineStart"] = Effect.fn(
    "SandboxService.machineStart",
  )(function* (input: SandboxMachineStartInput) {
    if (!hasConsent(input)) {
      return yield* machineError(
        "Starting a sandbox machine changes this machine, so it needs explicit consent.",
      );
    }
    const platform = normalizeSandboxPlatform(deps.platform);
    const row = sandboxRowsForPlatform(platform).find(
      (candidate) => candidate.backend.id === input.backend,
    );
    if (row === undefined) {
      return yield* machineError(`Unknown sandbox backend: ${input.backend}.`);
    }
    if (!row.supported) {
      return yield* machineError(
        `${row.backend.label} cannot run on this platform. ${row.unsupportedReason ?? ""}`.trim(),
      );
    }
    if (sandboxMachineImage(input.backend) === null) {
      return yield* machineError(
        "WSL2 is the prerequisite for containers, not a machine of its own. Create a Docker or Podman machine instead.",
      );
    }
    const status = yield* readStatus();
    const state = status.backends.find((entry) => entry.id === input.backend)?.state;
    if (state !== "available") {
      return yield* machineError(
        `${row.backend.label} is not installed on this machine yet, so it cannot start a sandbox. Install it in Setup first.`,
      );
    }
    const existing = yield* readMachine(input.backend);
    if (existing.state === "running") {
      return {
        ok: true,
        machine: existing,
        message: "The sandbox machine is already running.",
        outputTail: "",
      } satisfies SandboxMachineStartResult;
    }
    if (existing.state !== "stopped") {
      return yield* machineError(
        `There is no ${row.backend.label} machine to start. Create it in Setup first.`,
      );
    }

    // `tart run` never returns: nohup it in its own shell, then ask `tart list`
    // whether the VM actually came up instead of trusting the spawn.
    const output =
      input.backend === "tart"
        ? yield* runner.run({
            command: "sh",
            args: [
              "-c",
              `nohup tart run ${SANDBOX_MACHINE_NAME} --no-graphics >/dev/null 2>&1 & echo $!`,
            ],
            timeoutMs: MACHINE_START_TIMEOUT_MS,
          })
        : yield* runner.run({
            command: input.backend,
            args: ["start", SANDBOX_MACHINE_NAME],
            timeoutMs: MACHINE_START_TIMEOUT_MS,
          });
    const machine =
      input.backend === "tart"
        ? yield* waitForRunning(input.backend, MACHINE_START_POLL_ATTEMPTS)
        : yield* readMachine(input.backend);
    const outputTail = sanitizeOutputTail(`${output.stdout}\n${output.stderr}`);
    const ok = output.exitCode === 0 && machine.state === "running";
    return {
      ok,
      machine,
      message: ok
        ? `Started the ${row.backend.label} machine ${SANDBOX_MACHINE_NAME}.`
        : output.exitCode !== 0
          ? `${input.backend} start exited with code ${output.exitCode}.`
          : `The ${row.backend.label} machine is ${machine.state} after starting.`,
      outputTail,
    } satisfies SandboxMachineStartResult;
  });

  const machineStop: SandboxServiceTag["Service"]["machineStop"] = Effect.fn(
    "SandboxService.machineStop",
  )(function* (input: SandboxMachineStopInput) {
    if (!hasConsent(input)) {
      return yield* machineError(
        "Stopping a sandbox machine changes this machine, so it needs explicit consent.",
      );
    }
    const platform = normalizeSandboxPlatform(deps.platform);
    const notes: Array<string> = [];
    const tails: Array<string> = [];
    let stopped = false;
    let ok = true;

    for (const row of machineCapableBackends(platform)) {
      const machine = yield* readMachine(row.backend.id);
      if (machine.state !== "running") continue;
      const output =
        row.backend.id === "tart"
          ? yield* runner.run({
              command: "tart",
              args: ["stop", SANDBOX_MACHINE_NAME],
              timeoutMs: MACHINE_STOP_TIMEOUT_MS,
            })
          : yield* runner.run({
              command: row.backend.id,
              args: ["stop", SANDBOX_MACHINE_NAME],
              timeoutMs: MACHINE_STOP_TIMEOUT_MS,
            });
      const after = yield* readMachine(row.backend.id);
      const commandOk = output.exitCode === 0 && after.state !== "running";
      stopped = stopped || commandOk;
      ok = ok && commandOk;
      notes.push(
        commandOk
          ? `Stopped the ${row.backend.label} machine.`
          : output.exitCode !== 0
            ? `${row.backend.label} stop exited with code ${output.exitCode}.`
            : `The ${row.backend.label} machine is still ${after.state}.`,
      );
      tails.push(sanitizeOutputTail(`${output.stdout}\n${output.stderr}`));
    }

    return {
      ok,
      stopped,
      message: notes.length === 0 ? "No sandbox machine is running." : notes.join(" "),
      outputTail: tails.join("\n"),
    } satisfies SandboxMachineStopResult;
  });

  const machineRemove: SandboxServiceTag["Service"]["machineRemove"] = Effect.fn(
    "SandboxService.machineRemove",
  )(function* (input: SandboxMachineRemoveInput) {
    if (!hasConsent(input)) {
      return yield* machineError(
        "Removing a sandbox machine changes this machine, so it needs explicit consent.",
      );
    }
    const platform = normalizeSandboxPlatform(deps.platform);
    const notes: Array<string> = [];
    const tails: Array<string> = [];
    let removed = false;
    let ok = true;

    for (const row of machineCapableBackends(platform)) {
      const machine = yield* readMachine(row.backend.id);
      if (machine.state !== "running" && machine.state !== "stopped") continue;
      const output =
        row.backend.id === "tart"
          ? yield* runner.run({
              command: "tart",
              args: ["delete", SANDBOX_MACHINE_NAME],
              timeoutMs: MACHINE_REMOVE_TIMEOUT_MS,
            })
          : yield* runner.run({
              command: row.backend.id,
              args: ["rm", "-f", SANDBOX_MACHINE_NAME],
              timeoutMs: MACHINE_REMOVE_TIMEOUT_MS,
            });
      const commandOk = output.exitCode === 0;
      removed = removed || commandOk;
      ok = ok && commandOk;
      notes.push(
        commandOk
          ? `Removed the ${row.backend.label} machine.`
          : `${row.backend.label} remove exited with code ${output.exitCode}.`,
      );
      tails.push(sanitizeOutputTail(`${output.stdout}\n${output.stderr}`));
    }

    return {
      ok,
      removed,
      message: notes.length === 0 ? "There is no sandbox machine to remove." : notes.join(" "),
      outputTail: tails.join("\n"),
    } satisfies SandboxMachineRemoveResult;
  });

  const run: SandboxServiceTag["Service"]["run"] = Effect.fn("SandboxService.run")(function* (
    input: SandboxRunInput,
  ) {
    const problem = sandboxRunProblem(input);
    if (problem !== null) return yield* machineError(problem, "sandbox.run");
    const target = yield* requireRunningMachine("sandbox.run");

    const timeoutMs = input.timeoutMs ?? SANDBOX_COMMAND_TIMEOUT_DEFAULT_MS;
    const startedAt = yield* Clock.currentTimeMillis;
    const output = yield* runner.run({
      command: target.backend,
      args: ["exec", SANDBOX_MACHINE_NAME, "/bin/sh", "-lc", input.command],
      timeoutMs,
    });
    const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
    return {
      ok: output.exitCode === 0,
      exitCode: output.exitCode,
      stdout: sanitizeRunOutput(output.stdout),
      stderr: sanitizeRunOutput(output.stderr),
      durationMs,
      message:
        output.exitCode === 0
          ? `Command exited 0 in ${durationMs} ms.`
          : `Command exited with code ${output.exitCode}.`,
    } satisfies SandboxRunResult;
  });

  /**
   * Copy the thread's tracked files into the machine so a run can build or
   * test them. The archive is made on the host and unpacked inside the machine;
   * nothing is copied back out.
   */
  const machineSync: SandboxServiceTag["Service"]["machineSync"] = Effect.fn(
    "SandboxService.machineSync",
  )(function* (input: SandboxSyncInput) {
    const target = yield* requireRunningMachine("sandbox.machineSync");
    const cwd = shellQuote(input.cwd);

    const countOutput = yield* runner.run({
      command: "sh",
      args: ["-c", `git -C ${cwd} ls-files | wc -l`],
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const files = parseTrackedFiles(countOutput.stdout);

    const archiveOutput = yield* runner.run({
      command: "sh",
      args: ["-c", `git -C ${cwd} archive --format=tar HEAD | base64`],
      timeoutMs: SANDBOX_SYNC_TIMEOUT_MS,
    });
    if (archiveOutput.exitCode !== 0) {
      return {
        ok: false,
        files,
        bytes: 0,
        message: `Could not archive that project: ${
          firstLine(`${archiveOutput.stderr}\n${archiveOutput.stdout}`, PROBE_DETAIL_LIMIT) ??
          `git archive exited with code ${archiveOutput.exitCode}`
        }`,
        outputTail: sanitizeOutputTail(`${archiveOutput.stdout}\n${archiveOutput.stderr}`),
      } satisfies SandboxSyncResult;
    }

    // Base64 is 4 characters per 3 bytes; the caps are about the archive, not
    // the text that carries it.
    const base64 = archiveOutput.stdout;
    const bytes = Math.floor((base64.length * 3) / 4);
    const problem = sandboxSyncProblem({ files, bytes });
    if (problem !== null) {
      return {
        ok: false,
        files,
        bytes,
        message: problem,
        outputTail: "",
      } satisfies SandboxSyncResult;
    }

    const output = yield* runner.run({
      command: target.backend,
      args:
        target.backend === "tart"
          ? ["exec", SANDBOX_MACHINE_NAME, "sh", "-lc", SYNC_SCRIPT]
          : ["exec", "-i", SANDBOX_MACHINE_NAME, "sh", "-lc", SYNC_SCRIPT],
      stdin: base64,
      timeoutMs: SANDBOX_SYNC_TIMEOUT_MS,
    });
    const outputTail = sanitizeOutputTail(`${output.stdout}\n${output.stderr}`);
    if (output.exitCode !== 0) {
      return {
        ok: false,
        files,
        bytes,
        message: `The machine refused the copy: ${
          firstLine(`${output.stderr}\n${output.stdout}`, PROBE_DETAIL_LIMIT) ??
          `exit code ${output.exitCode}`
        }`,
        outputTail,
      } satisfies SandboxSyncResult;
    }

    return {
      ok: true,
      files,
      bytes,
      message: `Copied ${files} tracked files (${(bytes / 1024 / 1024).toFixed(1)} MB) into ${SANDBOX_SYNC_DIR} in the ${SANDBOX_MACHINE_NAME} machine.`,
      outputTail,
    } satisfies SandboxSyncResult;
  });

  return SandboxServiceTag.of({
    status,
    install,
    health,
    machineCreate,
    machineStart,
    machineStop,
    machineRemove,
    run,
    machineSync,
  });
};

const make = Effect.gen(function* () {
  const runner = yield* SandboxCommandRunner;
  const platform = yield* HostProcess.Platform;
  const arch = yield* HostProcess.Architecture;
  return makeSandboxService({ runner, platform, arch });
});

/** Requires a runner; tests provide a fake, production uses `liveLayer`. */
export const layer = Layer.effect(SandboxServiceTag, make);

/** Production wiring: probes and installs spawn through the server's ProcessRunner. */
export const liveLayer = layer.pipe(Layer.provide(commandRunnerLayer));

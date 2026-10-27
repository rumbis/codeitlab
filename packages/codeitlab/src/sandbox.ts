import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Sandbox backends CodeItLab can drive, and what is true about them on this
 * machine.
 *
 * Three rules keep this honest:
 *
 * 1. **No invented installers.** A backend whose install the app cannot perform
 *    ships a copy-command and says so; the row state is `not-installed`, never a
 *    button that pretends to work.
 * 2. **Platform truth first.** Tart is macOS-only (it runs Apple-silicon VMs).
 *    On Linux and Windows its row is `unsupported` with that sentence, and the
 *    alternative is a separate row, not a silent substitution.
 * 3. **Consent is a gate, not a badge.** Every install is a machine-level change,
 *    so the server refuses an install without `consent: true` and the UI asks
 *    first. The row state distinguishes "we can install this after you confirm"
 *    (`needs-consent`) from "you have to run this yourself" (`not-installed`).
 */

export const SandboxBackendId = Schema.Literals(["tart", "docker", "podman", "wsl2"]);
export type SandboxBackendId = typeof SandboxBackendId.Type;

/** The platforms the matrix knows about; anything else is `other`. */
export const SandboxHostPlatform = Schema.Literals(["darwin", "linux", "win32", "other"]);
export type SandboxHostPlatform = typeof SandboxHostPlatform.Type;

export const SandboxRowState = Schema.Literals([
  /** The CLI answered, so the backend can run a sandbox now. */
  "available",
  /** Supported here, but the install is a command the user runs themselves. */
  "not-installed",
  /** Supported here and installable by the app after explicit consent. */
  "needs-consent",
  /** This platform cannot run the backend at all. */
  "unsupported",
  /** The probe could not answer; we do not guess. */
  "unknown",
]);
export type SandboxRowState = typeof SandboxRowState.Type;

export interface SandboxBackendDefinition {
  readonly id: SandboxBackendId;
  readonly label: string;
  readonly summary: string;
  readonly supportedPlatforms: ReadonlyArray<SandboxHostPlatform>;
  /** argv used to ask the backend for its version; the probe runs it as-is. */
  readonly versionArgs: ReadonlyArray<string>;
  /** Install command per platform. `null` where the platform is unsupported. */
  readonly installCommands: Readonly<Partial<Record<SandboxHostPlatform, string>>>;
  /**
   * `app` means the server may run `installCommands` after consent; `manual`
   * means the command is copy-only because it needs root, a reboot, or a GUI.
   */
  readonly installMode: "app" | "manual";
  /** Shown next to the install action, e.g. "needs a reboot". */
  readonly installNote: string | null;
  /** Why the row can be installed but not used yet, when that is the case. */
  readonly healthNote: string;
  readonly docsUrl: string | null;
}

const TART: SandboxBackendDefinition = {
  id: "tart",
  label: "Tart",
  summary:
    "Apple-silicon macOS VMs. A disposable VM is the strongest sandbox on this machine: the agent's shell runs inside a copy, not in your checkout.",
  supportedPlatforms: ["darwin"],
  versionArgs: ["tart", "--version"],
  installCommands: { darwin: "brew install cirruslabs/cli/tart" },
  installMode: "app",
  installNote: "Homebrew installs the CLI; VM images are pulled on first boot.",
  healthNote: "Tart answers, so a VM sandbox can be created.",
  docsUrl: "https://tart.run",
};

const DOCKER: SandboxBackendDefinition = {
  id: "docker",
  label: "Docker",
  summary:
    "Containers. Cheaper than a VM and good enough for build/test isolation; the host kernel is still shared.",
  supportedPlatforms: ["darwin", "linux", "win32"],
  versionArgs: ["docker", "--version"],
  installCommands: {
    darwin: "brew install --cask docker",
    linux: "curl -fsSL https://get.docker.com | sh",
    win32: "wsl --install",
  },
  // The Linux script and the Windows path both need root/admin or a reboot, and
  // the macOS cask opens a GUI installer, so none of them are run from here.
  installMode: "manual",
  installNote: "Installing Docker needs administrator rights or a reboot.",
  healthNote: "Docker answers; check that the daemon is running before a run.",
  docsUrl: "https://docs.docker.com/get-docker/",
};

const PODMAN: SandboxBackendDefinition = {
  id: "podman",
  label: "Podman",
  summary:
    "Rootless containers. Same isolation idea as Docker without a daemon, which is why it is the Linux fallback when Docker is not wanted.",
  supportedPlatforms: ["darwin", "linux", "win32"],
  versionArgs: ["podman", "--version"],
  installCommands: {
    darwin: "brew install podman",
    linux: "sudo apt install podman",
    win32: "wsl --install",
  },
  installMode: "manual",
  installNote: "Package installs need administrator rights.",
  healthNote: "Podman answers; a machine may still need a podman machine.",
  docsUrl: "https://podman.io",
};

const WSL2: SandboxBackendDefinition = {
  id: "wsl2",
  label: "WSL2",
  summary:
    "The Windows path: a Linux kernel inside Windows. It is a prerequisite for containers, not a container runtime by itself.",
  supportedPlatforms: ["win32"],
  versionArgs: ["wsl", "--version"],
  installCommands: { win32: "wsl --install" },
  installMode: "manual",
  installNote: "Needs administrator rights and a reboot.",
  healthNote: "WSL2 answers; a distribution still has to be installed.",
  docsUrl: "https://learn.microsoft.com/windows/wsl/install",
};

export const SANDBOX_BACKENDS: ReadonlyArray<SandboxBackendDefinition> = [
  TART,
  DOCKER,
  PODMAN,
  WSL2,
];

/** The backend to prefer on a platform, before asking what is installed. */
const RECOMMENDED: Readonly<Record<SandboxHostPlatform, SandboxBackendId | null>> = {
  darwin: "tart",
  linux: "docker",
  win32: "wsl2",
  other: null,
};

export function normalizeSandboxPlatform(platform: string): SandboxHostPlatform {
  return platform === "darwin" || platform === "linux" || platform === "win32" ? platform : "other";
}

export function sandboxBackend(id: SandboxBackendId): SandboxBackendDefinition {
  const backend = SANDBOX_BACKENDS.find((candidate) => candidate.id === id);
  // The id is a literal union, so the fallback is unreachable; keep the total type.
  return backend ?? TART;
}

export function sandboxSupportsPlatform(
  backend: SandboxBackendDefinition,
  platform: SandboxHostPlatform,
): boolean {
  return backend.supportedPlatforms.includes(platform);
}

/** Why a row cannot be used on this platform, or `null` when it can. */
export function sandboxUnsupportedReason(
  backend: SandboxBackendDefinition,
  platform: SandboxHostPlatform,
): string | null {
  if (sandboxSupportsPlatform(backend, platform)) return null;
  if (platform === "other") return backend.label + " is not available on this platform.";
  if (backend.id === "tart") {
    // The sentence the Setup page shows verbatim: Tart runs Apple-silicon VMs.
    return "Tart is macOS-only.";
  }
  if (backend.id === "wsl2") return "WSL2 is Windows-only.";
  return backend.label + " is not available on this platform.";
}

export function sandboxInstallCommand(
  backend: SandboxBackendDefinition,
  platform: SandboxHostPlatform,
): string | null {
  if (!sandboxSupportsPlatform(backend, platform)) return null;
  return backend.installCommands[platform] ?? null;
}

export interface SandboxRow {
  readonly backend: SandboxBackendDefinition;
  readonly platform: SandboxHostPlatform;
  readonly supported: boolean;
  readonly installCommand: string | null;
  /** True only when the server may run the command after consent. */
  readonly autoInstall: boolean;
  readonly unsupportedReason: string | null;
  readonly recommended: boolean;
}

export function sandboxRowsForPlatform(platform: SandboxHostPlatform): ReadonlyArray<SandboxRow> {
  const recommendedId = RECOMMENDED[platform];
  return SANDBOX_BACKENDS.map((backend) => {
    const supported = sandboxSupportsPlatform(backend, platform);
    const command = sandboxInstallCommand(backend, platform);
    return {
      backend,
      platform,
      supported,
      installCommand: command,
      autoInstall: supported && backend.installMode === "app" && command !== null,
      unsupportedReason: sandboxUnsupportedReason(backend, platform),
      recommended: backend.id === recommendedId,
    };
  });
}

/**
 * Turn one probe answer into a row state. `probeFailed` outranks "not
 * installed": if the version command could not be run we do not know whether the
 * backend is there, and saying "not installed" would invite a second install of
 * something that already exists.
 */
export function sandboxRowState(input: {
  readonly supported: boolean;
  readonly installed: boolean;
  readonly probeFailed: boolean;
  readonly autoInstall: boolean;
}): SandboxRowState {
  if (!input.supported) return "unsupported";
  if (input.probeFailed) return "unknown";
  if (input.installed) return "available";
  return input.autoInstall ? "needs-consent" : "not-installed";
}

/** The sentence a disabled action points at, via `aria-describedby`. */
export function sandboxRowReason(
  state: SandboxRowState,
  row: SandboxRow,
  detail: string | null,
): string {
  switch (state) {
    case "available":
      return row.backend.healthNote;
    case "unsupported":
      return row.unsupportedReason ?? row.backend.label + " is not available on this platform.";
    case "unknown":
      return (
        row.backend.label +
        " did not answer its version check" +
        (detail === null || detail.trim() === "" ? "." : ": " + detail.trim())
      );
    case "needs-consent":
      return row.installCommand === null
        ? row.backend.label + " is not installed and no install command is known here."
        : row.backend.label +
            " is not installed. Installing runs " +
            row.installCommand +
            " on this machine, so it waits for your consent.";
    case "not-installed":
      return row.installCommand === null
        ? row.backend.label + " is not installed."
        : row.backend.label +
            " is not installed. Run " +
            row.installCommand +
            " yourself; the app does not run this one.";
  }
}

export function sandboxRecommendedBackend(platform: SandboxHostPlatform): SandboxBackendId | null {
  return RECOMMENDED[platform];
}

/** Ready means the recommended backend for this platform answered its probe. */
export function sandboxReady(
  platform: SandboxHostPlatform,
  states: Readonly<Partial<Record<SandboxBackendId, SandboxRowState>>>,
): boolean {
  const recommended = RECOMMENDED[platform];
  return recommended !== null && states[recommended] === "available";
}

export const SandboxBackendStatus = Schema.Struct({
  id: SandboxBackendId,
  label: Schema.String,
  summary: Schema.String,
  platform: SandboxHostPlatform,
  state: SandboxRowState,
  /** Version string the CLI reported, when it answered. */
  version: Schema.NullOr(Schema.String),
  installCommand: Schema.NullOr(Schema.String),
  autoInstall: Schema.Boolean,
  installNote: Schema.NullOr(Schema.String),
  /** Why the row's action is disabled; `null` when nothing is disabled. */
  reason: Schema.NullOr(Schema.String),
  recommended: Schema.Boolean,
  docsUrl: Schema.NullOr(Schema.String),
});
export type SandboxBackendStatus = typeof SandboxBackendStatus.Type;

export const SandboxStatus = Schema.Struct({
  platform: SandboxHostPlatform,
  arch: Schema.String,
  checkedAt: Schema.String,
  backends: Schema.Array(SandboxBackendStatus),
  recommendedId: Schema.NullOr(SandboxBackendId),
  ready: Schema.Boolean,
  /** True when the app may run an install at all on this host. */
  installAvailable: Schema.Boolean,
  /** Host-level caveats worth showing once, e.g. no Homebrew. */
  notes: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type SandboxStatus = typeof SandboxStatus.Type;

export const SandboxInstallInput = Schema.Struct({
  backend: SandboxBackendId,
  /**
   * A literal `true`. The server rejects anything else, so an install cannot
   * happen because a client forgot to ask.
   */
  consent: Schema.Literal(true),
});
export type SandboxInstallInput = typeof SandboxInstallInput.Type;

export const SandboxInstallResult = Schema.Struct({
  backend: SandboxBackendId,
  ok: Schema.Boolean,
  message: Schema.String,
  /** Last lines of the install output, ANSI-stripped and capped. Never env. */
  outputTail: Schema.String,
  status: SandboxStatus,
});
export type SandboxInstallResult = typeof SandboxInstallResult.Type;

/**
 * A backend answering its version check proves the CLI exists. It does not
 * prove a sandbox can run: Tart needs its VM list to work, Docker and Podman
 * need a reachable daemon, WSL needs a distribution. These are the second
 * checks, kept here so the server only executes them and the page only renders
 * their answers.
 */
export const SandboxCheck = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  ok: Schema.Boolean,
  /** First line of the check's output, sanitized; null when the check passed. */
  detail: Schema.NullOr(Schema.String),
});
export type SandboxCheck = typeof SandboxCheck.Type;

export const SandboxHealthBackend = Schema.Struct({
  id: SandboxBackendId,
  label: Schema.String,
  state: SandboxRowState,
  recommended: Schema.Boolean,
  /** True only when the backend answered every check. */
  healthy: Schema.Boolean,
  checks: Schema.Array(SandboxCheck),
  /** One sentence: what passed, or the first thing that did not. */
  message: Schema.String,
});
export type SandboxHealthBackend = typeof SandboxHealthBackend.Type;

/**
 * The machine the app creates and runs commands in.
 *
 * One machine per backend, with a stable name, so the page can say "the
 * sandbox" without a naming dialog. The app never pulls a VM image by itself:
 * creating a Tart machine clones an image the user already has, and a missing
 * image comes back as the "tart pull" command to run, not as a silent 30 GB
 * download.
 */
export const SandboxMachineState = Schema.Literals([
  /** Created and answering commands. */
  "running",
  /** Created but not started (a Tart VM the app does not keep in the background). */
  "stopped",
  /** Nothing was created yet. */
  "missing",
  /** This backend cannot own a machine here (WSL2 is a prerequisite, not a runtime). */
  "unsupported",
  /** The state probe could not answer. */
  "unknown",
]);
export type SandboxMachineState = typeof SandboxMachineState.Type;

export const SandboxMachine = Schema.Struct({
  backend: SandboxBackendId,
  name: Schema.String,
  image: Schema.NullOr(Schema.String),
  state: SandboxMachineState,
  /** First sanitized line of the state probe; null when there is nothing to say. */
  detail: Schema.NullOr(Schema.String),
});
export type SandboxMachine = typeof SandboxMachine.Type;

export const SandboxHealth = Schema.Struct({
  platform: SandboxHostPlatform,
  arch: Schema.String,
  checkedAt: Schema.String,
  backends: Schema.Array(SandboxHealthBackend),
  /** The backend the page should call ready, if one is. */
  readyId: Schema.NullOr(SandboxBackendId),
  ready: Schema.Boolean,
  message: Schema.String,
  /**
   * The machine on the ready backend, when one is installed. Null means "no
   * backend can own a machine here", not "the state is unknown".
   */
  machine: Schema.NullOr(SandboxMachine),
});
export type SandboxHealth = typeof SandboxHealth.Type;

/** What a readiness command answered, already decoded to text by the caller. */
export interface SandboxReadinessOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SandboxReadinessResult {
  /** True only when the answer proves a sandbox can run, not merely that a CLI did. */
  readonly ok: boolean;
  /**
   * The line that explains a failure, straight from the command; null when the
   * check passed. Not sanitized here: the server redacts ANSI and secrets
   * before any detail crosses the wire.
   */
  readonly detail: string | null;
}

export interface SandboxReadinessCheck {
  readonly id: string;
  readonly label: string;
  readonly argv: ReadonlyArray<string>;
  /**
   * Reads the answer. The default is "exit code 0", which is right for a
   * daemon; WSL needs more, because `wsl --list` succeeds on a machine with no
   * distribution installed, and a distribution is the thing that can run work.
   */
  readonly evaluate?: (output: SandboxReadinessOutput) => SandboxReadinessResult;
}

/** The first non-empty line, cut to `limit` characters; null when there is none. */
export function sandboxFirstLine(text: string, limit: number): string | null {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (line === undefined) return null;
  return line.length <= limit ? line : line.slice(0, limit - 1) + "…";
}

/**
 * WSL's `--list --quiet` answer, decoded. Windows prints UTF-16LE, which a
 * byte-wise read leaves full of NULs, so the NULs are stripped before the lines
 * are split; the "no installed distributions" sentence is not a distribution.
 */
export function decodeWslDistroList(raw: string): ReadonlyArray<string> {
  // eslint-disable-next-line no-control-regex -- a UTF-16LE read leaves NULs, and removing them is the point.
  const text = raw.includes("\u0000") ? raw.replace(/\u0000/g, "") : raw;
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, "").trim())
    .filter((line) => line.length > 0 && !/^no (installed )?distributions?/i.test(line));
}

/** The sentence shown when WSL answers but has nothing to run work in. */
export const WSL_NO_DISTRO_DETAIL =
  "No distribution is installed. Run `wsl --install -d Ubuntu` (needs administrator).";

/**
 * The one place a readiness answer becomes a verdict, so the server only runs
 * commands and the page only renders this.
 */
export function sandboxReadinessResult(
  check: SandboxReadinessCheck,
  output: SandboxReadinessOutput,
): SandboxReadinessResult {
  if (check.evaluate !== undefined) return check.evaluate(output);
  const ok = output.exitCode === 0;
  return {
    ok,
    detail: ok
      ? null
      : (sandboxFirstLine(output.stderr, 200) ?? sandboxFirstLine(output.stdout, 200)),
  };
}

/**
 * The check each backend gets on top of its version command. WSL's output is
 * UTF-16LE on Windows, so a garbled line is reported as a failed check rather
 * than cleaned up into a fake success.
 */
export const SANDBOX_READINESS_CHECKS: Readonly<
  Partial<Record<SandboxBackendId, SandboxReadinessCheck>>
> = {
  tart: { id: "vm-list", label: "Tart answers its VM list", argv: ["list", "--format", "json"] },
  docker: {
    id: "daemon",
    label: "The Docker daemon answers",
    argv: ["info", "--format", "{{.ServerVersion}}"],
  },
  podman: {
    id: "daemon",
    label: "Podman answers its info",
    argv: ["info", "--format", "{{.Version.Version}}"],
  },
  wsl2: {
    id: "distros",
    label: "WSL lists a distribution it can run",
    argv: ["--list", "--quiet"],
    evaluate: (output) => {
      if (output.exitCode !== 0) {
        return {
          ok: false,
          detail: sandboxFirstLine(output.stderr, 200) ?? sandboxFirstLine(output.stdout, 200),
        };
      }
      const distros = decodeWslDistroList(output.stdout);
      return distros.length > 0
        ? { ok: true, detail: null }
        : { ok: false, detail: WSL_NO_DISTRO_DETAIL };
    },
  },
};

export function sandboxFirstFailure(checks: ReadonlyArray<SandboxCheck>): SandboxCheck | null {
  return checks.find((check) => !check.ok) ?? null;
}

/** One sentence per backend, built from the state and the checks that ran. */
export function sandboxHealthBackendMessage(input: {
  readonly label: string;
  readonly state: SandboxRowState;
  readonly checks: ReadonlyArray<SandboxCheck>;
}): string {
  if (input.state === "unsupported") return input.label + " cannot run on this platform.";
  if (input.state === "unknown") return input.label + " did not answer its version check.";
  if (input.state === "not-installed" || input.state === "needs-consent") {
    return input.label + " is not installed.";
  }
  const failure = sandboxFirstFailure(input.checks);
  if (failure === null) return input.label + " answered every check.";
  const detail = failure.detail === null ? "" : ": " + failure.detail;
  return (
    input.label +
    " answered its version check, but " +
    failure.label.toLowerCase() +
    " failed" +
    detail
  );
}

/**
 * The sentence the page leads with. A ready backend is named; otherwise the
 * recommended backend's own message is the reason, so the page never says
 * "not ready" without saying what is missing.
 */
export function sandboxHealthMessage(backends: ReadonlyArray<SandboxHealthBackend>): string {
  const healthy =
    backends.find((backend) => backend.healthy && backend.recommended) ??
    backends.find((backend) => backend.healthy);
  if (healthy !== undefined) return "Sandbox ready: " + healthy.message;
  const recommended = backends.find((backend) => backend.recommended);
  if (recommended !== undefined) return "Sandbox not ready: " + recommended.message;
  return "No sandbox backend can run on this platform.";
}

/** One machine per backend; the name is stable so status and create agree. */
export const SANDBOX_MACHINE_NAME = "codeitlab-sandbox";

/** The image each backend clones or runs. Tart images are never pulled by the app. */
export const SANDBOX_MACHINE_IMAGES: Readonly<Partial<Record<SandboxBackendId, string>>> = {
  tart: "ghcr.io/cirruslabs/macos-sonoma-base:latest",
  docker: "node:22-bookworm-slim",
  podman: "node:22-bookworm-slim",
};

export const SANDBOX_COMMAND_MAX_LENGTH = 4_000;
export const SANDBOX_COMMAND_TIMEOUT_DEFAULT_MS = 10_000;
export const SANDBOX_COMMAND_TIMEOUT_MAX_MS = 120_000;
export const SANDBOX_RUN_OUTPUT_LIMIT = 8_000;

/** The backend's image, or null when this backend cannot own a machine. */
export function sandboxMachineImage(backend: SandboxBackendId): string | null {
  return SANDBOX_MACHINE_IMAGES[backend] ?? null;
}

/** True when the backend can own a machine at all (WSL2 cannot). */
export function sandboxMachineBackend(backend: SandboxBackendId): boolean {
  return sandboxMachineImage(backend) !== null;
}

/** Why a run cannot start, or null when the command and timeout are acceptable. */
export function sandboxRunProblem(input: {
  readonly command: string;
  readonly timeoutMs?: number | undefined;
}): string | null {
  const command = input.command.trim();
  if (command.length === 0) return "Write a command to run in the sandbox.";
  if (command.length > SANDBOX_COMMAND_MAX_LENGTH) {
    return "The command is longer than " + SANDBOX_COMMAND_MAX_LENGTH + " characters.";
  }
  const timeout = input.timeoutMs;
  if (timeout !== undefined) {
    if (!Number.isInteger(timeout) || timeout < 1_000) {
      return "The timeout has to be a whole number of at least 1000 ms.";
    }
    if (timeout > SANDBOX_COMMAND_TIMEOUT_MAX_MS) {
      return "The timeout cannot be more than " + SANDBOX_COMMAND_TIMEOUT_MAX_MS + " ms.";
    }
  }
  return null;
}

export const SandboxMachineCreateInput = Schema.Struct({
  backend: SandboxBackendId,
  /** Creating a machine is a machine-level change, so it needs explicit consent. */
  consent: Schema.Literal(true),
});
export type SandboxMachineCreateInput = typeof SandboxMachineCreateInput.Type;

export const SandboxMachineCreateResult = Schema.Struct({
  ok: Schema.Boolean,
  machine: SandboxMachine,
  message: Schema.String,
  /** Last lines of the create output, ANSI-stripped and capped. Never env. */
  outputTail: Schema.String,
});
export type SandboxMachineCreateResult = typeof SandboxMachineCreateResult.Type;

export const SandboxMachineStartInput = Schema.Struct({
  backend: SandboxBackendId,
  /** Starting a VM or container is a machine-level change: consent is literal. */
  consent: Schema.Literal(true),
});
export type SandboxMachineStartInput = typeof SandboxMachineStartInput.Type;

export const SandboxMachineStartResult = Schema.Struct({
  ok: Schema.Boolean,
  machine: SandboxMachine,
  message: Schema.String,
  outputTail: Schema.String,
});
export type SandboxMachineStartResult = typeof SandboxMachineStartResult.Type;

export const SandboxMachineStopInput = Schema.Struct({
  consent: Schema.Literal(true),
});
export type SandboxMachineStopInput = typeof SandboxMachineStopInput.Type;

export const SandboxMachineStopResult = Schema.Struct({
  ok: Schema.Boolean,
  stopped: Schema.Boolean,
  message: Schema.String,
  outputTail: Schema.String,
});
export type SandboxMachineStopResult = typeof SandboxMachineStopResult.Type;

export const SandboxMachineRemoveInput = Schema.Struct({
  consent: Schema.Literal(true),
});
export type SandboxMachineRemoveInput = typeof SandboxMachineRemoveInput.Type;

export const SandboxMachineRemoveResult = Schema.Struct({
  ok: Schema.Boolean,
  removed: Schema.Boolean,
  message: Schema.String,
  outputTail: Schema.String,
});
export type SandboxMachineRemoveResult = typeof SandboxMachineRemoveResult.Type;

export const SandboxRunInput = Schema.Struct({
  command: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
});
export type SandboxRunInput = typeof SandboxRunInput.Type;

export const SandboxRunResult = Schema.Struct({
  ok: Schema.Boolean,
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  durationMs: Schema.Number,
  message: Schema.String,
});
export type SandboxRunResult = typeof SandboxRunResult.Type;

/** Where a sync puts the thread's files inside the machine. */
export const SANDBOX_SYNC_DIR = "/work";

/**
 * A sync copies the thread's **tracked** files only: `git archive HEAD` skips
 * everything gitignored, so secrets in `.env` never leave the host by accident,
 * and the caps keep a monorepo from becoming a gigabyte of base64.
 */
export const SANDBOX_SYNC_MAX_FILES = 500;
export const SANDBOX_SYNC_MAX_BYTES = 8 * 1024 * 1024;
export const SANDBOX_SYNC_TIMEOUT_MS = 60_000;

export const SandboxSyncInput = Schema.Struct({
  /**
   * The working directory to copy. The MCP handler resolves it from the calling
   * thread (worktree path, or the project root); nothing on the wire names a
   * path the caller chooses.
   */
  cwd: Schema.String,
});
export type SandboxSyncInput = typeof SandboxSyncInput.Type;

export const SandboxSyncResult = Schema.Struct({
  ok: Schema.Boolean,
  /** Tracked files the archive held. */
  files: Schema.Number,
  /** Archive bytes, before base64; 0 when nothing was copied. */
  bytes: Schema.Number,
  message: Schema.String,
  outputTail: Schema.String,
});
export type SandboxSyncResult = typeof SandboxSyncResult.Type;

/** Why a sync cannot run, or null when the counts fit the caps. */
export function sandboxSyncProblem(input: {
  readonly files: number;
  readonly bytes: number;
}): string | null {
  if (input.files > SANDBOX_SYNC_MAX_FILES) {
    return (
      "This project has " +
      String(input.files) +
      " tracked files; the machine takes at most " +
      String(SANDBOX_SYNC_MAX_FILES) +
      ". Copy a subdirectory instead, or raise the cap."
    );
  }
  if (input.bytes > SANDBOX_SYNC_MAX_BYTES) {
    return (
      "This project's tracked files are " +
      String(Math.ceil(input.bytes / 1024 / 1024)) +
      " MB; the machine takes at most " +
      String(SANDBOX_SYNC_MAX_BYTES / 1024 / 1024) +
      " MB."
    );
  }
  return null;
}

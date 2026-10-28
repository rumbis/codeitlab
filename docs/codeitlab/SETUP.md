# Setup: sandbox backends

The Setup surface answers one question before an agent runs anything risky: **can
this machine give the agent a disposable place to work?** It is a matrix, not a
wizard. Every row says what the backend is, whether it is here, and what the next
action actually does.

## The matrix

| Backend | macOS (Apple silicon) | Linux       | Windows     | Install                            |
| ------- | --------------------- | ----------- | ----------- | ---------------------------------- |
| Tart    | recommended           | unsupported | unsupported | `brew install cirruslabs/cli/tart` |
| Docker  | supported             | supported   | supported   | per platform, manual               |
| Podman  | supported             | supported   | supported   | per platform, manual               |
| WSL2    | unsupported           | unsupported | recommended | `wsl --install`                    |

Tart runs Apple-silicon macOS VMs, so on Linux and Windows its row says
**"Tart is macOS-only."** and offers no install. The alternative is a separate
Docker or Podman row, not a silent substitution.

## The five states

| State           | Means                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| `available`     | The CLI answered its version check; a sandbox can be created now.         |
| `not-installed` | Supported here, but the install is a command **you** run.                 |
| `needs-consent` | Supported here and installable by the app once you confirm the command.   |
| `unsupported`   | This platform cannot run it at all.                                       |
| `unknown`       | The probe could not answer. We do not guess, and we do not say "missing". |

`unknown` is the important one: a probe that fails is not evidence that a
backend is absent, so the row refuses to invite a second install of something
that may already exist.

## What the app runs, and what it never runs

The app installs only the commands it can run safely on its own: today that is
Tart through Homebrew. Everything that needs root, a reboot, or a GUI installer
stays a copy-command — the Docker Linux script, the macOS cask, `wsl --install`,
and the package-manager lines for Podman.

An install is a machine-level change, so it is gated twice: the UI asks for
consent and shows the exact command, and the wire schema only accepts
`consent: true`, so a client that forgot to ask cannot install anything. The
server never runs an install in tests — the command runner is injected, and the
test double is the only thing that answers.

What the page does **not** do:

- It does not download VM images. Tart pulls an image on first boot, which is the
  first moment the real cost appears.
- It does not run `sudo`, elevate, or reboot.
- It does not claim a backend is ready because a command exited zero: after an
  install it probes again and reports what the probe saw.
- It does not print environment variables or the full output of an installer; the
  tail is ANSI-stripped and capped.

## Health: what "Sandbox ready" actually proves

A version check proves a binary exists. It does not prove a sandbox can run, so
`SandboxService.health` asks each installed backend the one question its version
cannot answer. The checks are declared in the matrix (`SANDBOX_READINESS_CHECKS`)
so the server only executes them and the page only renders them:

| Backend | Readiness check                             | Why it can fail while `--version` works                 |
| ------- | ------------------------------------------- | ------------------------------------------------------- |
| Tart    | `tart list --format json`                   | The CLI is present but its VM service is not answering. |
| Docker  | `docker info --format {{.ServerVersion}}`   | The daemon is not running or the socket is unreachable. |
| Podman  | `podman info --format {{.Version.Version}}` | Rootless storage or the runtime is broken.              |
| WSL2    | `wsl --list --quiet`                        | WSL is installed but no distribution exists.            |

Rules the health path keeps:

- **No readiness check without a version check.** A missing binary stays
  `not-installed`; it is not a second failure to explain.
- **Unsupported backends are not spawned at all.** On Linux the Tart row returns
  `unsupported` with an empty check list instead of running `tart`.
- **The failing line is the answer.** A failed check carries the first sanitized
  line of its output (ANSI stripped, env assignments redacted, capped), so the
  page can show the daemon's own words instead of "check failed".
- **WSL is judged by its list, not its exit code.** `wsl --list --quiet` exits 0
  on a machine with no distribution, and only a distribution can run work. The
  answer is decoded (Windows prints UTF-16LE, so the NULs are stripped first),
  and an empty list fails the check with the `wsl --install -d Ubuntu` command
  instead of letting the page say "Sandbox ready".
- **The sentence comes from the server.** `sandboxHealthMessage` builds
  "Sandbox ready: …" or "Sandbox not ready: …" from the checks; the page renders
  it and never composes its own claim.
- **Health is read-only.** It installs nothing, creates no VM and downloads no
  image. It runs four short commands with a five-second timeout each.

## Where it lives

- `packages/codeitlab/src/sandbox.ts` — the backend matrix, the state machine, the
  readiness checks and the health sentences. Pure, so the server and the page
  cannot disagree.
- `apps/server/src/codeitlab/sandbox/SandboxService.ts` — the probe, the
  consent-gated install, the re-probe and the health checks.
- `apps/web/src/components/codeitlab/CodeItLabSetupPage.tsx` — the surface at
  `/settings/codeitlab/setup`.

## The machine: create, start, run, stop, remove

Health answers "can this machine run a sandbox". The machine is the next layer:
one per backend, with the stable name `codeitlab-sandbox`, so there is no naming
dialog and status, create and remove always agree.

| Backend         | Create                                                         | Start                                                                | Run a command                                                            | Stop                           | Remove                          |
| --------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------ | ------------------------------- |
| Docker / Podman | `<bin> run -d --name codeitlab-sandbox <image> sleep infinity` | `<bin> start codeitlab-sandbox` (create already starts it)           | `<bin> exec codeitlab-sandbox /bin/sh -lc <command>`                     | `<bin> stop codeitlab-sandbox` | `<bin> rm -f codeitlab-sandbox` |
| Tart            | `tart clone <image> codeitlab-sandbox`                         | `nohup tart run codeitlab-sandbox --no-graphics &`, then `tart list` | `tart exec codeitlab-sandbox /bin/sh -lc <command>` (only while running) | `tart stop codeitlab-sandbox`  | `tart delete codeitlab-sandbox` |

Two decisions keep this honest:

- **Tart is cloned first, started later.** `tart run` never returns, so Start
  backgrounds it with `nohup` and then asks `tart list` whether the VM actually
  came up; the spawn's exit code is not treated as proof. If the VM did not
  start, the result says "is stopped after starting" instead of claiming
  success. The page still shows the manual `tart run … --no-graphics` command
  for anyone who would rather keep the VM in their own terminal.
- **A stopped machine refuses commands** and names the Start button and the
  manual command, so a failure never looks like a sandbox that ran nothing.
- **The app never pulls a VM image.** A missing Tart image comes back as
  `tart pull <image>` with the sentence "the app does not download VM images".
  Containers may pull their (small) image during create, and the confirm group
  says so before it runs.

Caps and consent:

- create, start, stop and remove require `consent: true` on the wire, so a
  client that forgot to ask cannot change the machine;
- one command at a time, up to 4,000 characters, timeout 10 s by default and
  120 s at most;
- output keeps its tail (last 8,000 characters), is ANSI-stripped and
  env-redacted before it crosses the wire;
- create is idempotent: an existing machine answers "already running" and runs
  no second command;
- start is idempotent too: a running machine answers "already running" and does
  not spawn a second `tart run`; stop says "No sandbox machine is running" when
  there is nothing to stop.

## What an agent can do with it

The machine is on the app's own MCP server, so every provider session already
reaches it — no extra config, no new server to install:

| Tool                 | Does                                                                                                                                             | Needs                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `cil_sandbox_status` | reports backend readiness, the machine's name/image/state, and the start command for a stopped Tart VM. Probes only; runs nothing in the sandbox | nothing (read-only)                                         |
| `cil_sandbox_sync`   | copies the calling thread's **git-tracked** files into `/work` inside the machine (caps: 500 files / 8 MB), so a build or a test can run there   | a live **full-access** thread and a machine that is running |
| `cil_sandbox_run`    | runs one command inside the running machine and returns exit code, stdout/stderr tail and duration                                               | a live **full-access** thread and a machine that is running |

A sync moves the thread's work in one direction only: `git archive HEAD` ships
tracked files and nothing else, so a gitignored `.env` stays on the host, and
nothing is copied back out. The archive travels as base64 on stdin (one string,
no temp files) and is unpacked by the machine's own `tar`. The caps are checked
before the machine is touched, so a monorepo is refused with its own file count
instead of half-copied.

Three things stay human decisions on purpose: **create**, **start/stop** and
**remove**. All need `consent: true` on the wire, which means the Setup page
asked; an agent passing `true` on its own is not consent, so none of them is a
tool. A stopped machine fails `cil_sandbox_run` with the Start button and the
manual command, and the app never starts it for the agent.

## Not done yet

No turn is routed into the machine: the agent still runs on the host and calls
the sandbox through tools, rather than the whole session running inside it. That
is the rest of the objective's G4. The page says "Sandbox ready" about the
backend and "running" about the machine — never about a turn.

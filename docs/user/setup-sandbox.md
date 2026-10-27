# Sandboxes: give the agent a disposable machine

Open **Settings → CodeItLab → Setup**. The page lists the sandbox backends that
make sense for your computer and tells you what is already there.

## Reading the table

- **Tart** is the macOS choice: a throwaway Apple-silicon VM. On Linux and Windows
  its row says "Tart is macOS-only." — there is no pretend installer.
- **Docker** and **Podman** run containers on macOS, Linux and Windows.
- **WSL2** is the Windows prerequisite for containers, not a container runtime by
  itself.

Each row is in one of five states: _available_, _not installed_, _needs consent_,
_unsupported_, or _unknown_. "Unknown" means the check could not run; it never
means "missing", so do not install a second copy on its word.

## Installing

- **Install** appears only when the app can run the command itself. It shows you
  the exact command first and does nothing until you confirm.
- **Copy command** appears whenever there is a command to run. Commands that need
  an administrator password, a reboot, or a GUI installer are copy-only on
  purpose: the app does not run them for you.
- After an install the page checks again and only then says **Sandbox ready**.

The page does not download VM images, does not use `sudo`, and does not print
installer output beyond a short tail.

## What "Sandbox ready" proves

A backend answering `--version` only proves the program exists. So the **Health**
card asks one more question, and **Sandbox ready** appears only when both pass:

| Backend | Second check              | What a failure means                                       |
| ------- | ------------------------- | ---------------------------------------------------------- |
| Tart    | `tart list --format json` | The Tart CLI is there but its VM service does not answer.  |
| Docker  | `docker info`             | The CLI is installed but the Docker daemon is not running. |
| Podman  | `podman info`             | Podman cannot read its own storage or runtime.             |
| WSL2    | `wsl --list --quiet`      | WSL is installed but has no distribution to run.           |

On Windows, WSL2 counts as ready only when a distribution exists: the CLI alone
can do nothing, so an empty distribution list is a failed check and the card
gives you the `wsl --install -d Ubuntu` command.

Each check is shown with the line the command printed, so you can act on the real
error instead of a generic failure. When a check fails the card says
**Sandbox not ready** and names the backend and the check. Nothing is installed
by the health check and no VM image is downloaded.

Ready still means **this machine can run a sandbox**, not that one exists yet.

## Creating the sandbox

Once a backend is ready, the **Sandbox machine** card creates one machine named
`codeitlab-sandbox`:

- **Docker or Podman**: Create runs the container detached and the machine shows
  **running**. You can type a command (default `uname -a`) and press **Run** to
  see it execute inside the container.
- **Tart**: Create clones the VM from an image you already have, and the machine
  shows **stopped** until you press **Start**. Start backgrounds `tart run` and
  then asks `tart list` whether the VM came up, so the badge means the VM is
  really running; **Stop** shuts it down. The old manual start command is still
  shown if you would rather keep the VM in your own terminal. If it did not come
  up, Start says so instead of pretending.
- **Remove** deletes the machine. Create and Remove ask you to confirm first, and
  creating may download a container image — the confirmation says which one.
  Start and Stop act on the press, because the press is the consent.

The app never pulls a Tart image by itself. If the image is missing, Create says
so and gives you the `tart pull` command instead of starting a large download.

## What agents can do with it

Once the machine is **running**, the agent in a thread can check it, copy the
thread's tracked files into `/work` inside it, and run commands there — enough
to build or test the project in the disposable machine. Only git-tracked files
are copied (a gitignored `.env` stays on your machine), nothing comes back out,
and the copy is capped at 500 files / 8 MB. Commands are up to 4,000 characters
and 10 s by default. Running commands
needs a thread in full-access mode, and the agent can never create, start, stop or
remove the machine — those stay your decisions in this card.

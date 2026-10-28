# The settings panel, section by section

CodeItLab's own panel lives under **Settings → CodeItLab** and has 26 sections.
This page says what each one is for, what it needs to work, and what it will not
do — so you can find the right page without opening all of them.

The panel is keyboard-first: every section is a tab stop, groups of switches move
with the arrow keys, and every disabled control names the thing that has to
happen first in a line right below it.

## Start here

| Section      | What it does                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview** | Today's picture: quest progress, catalog build time, the next quest, and one click to put it on the board.                                                                                                                   |
| **Agents**   | The ACP agents this machine can run, what is installed, and the install button for each one. Installs run on a _connected_ computer, so a remote environment can refuse them — the card says so instead of failing silently. |
| **Effects**  | Ambient scene, sound effects and their volumes. SFX is opt-in and short; every animation has a reduced-motion branch.                                                                                                        |
| **Nexus**    | One catalog of the skills, sessions and MCP servers every ACP reports, with a filter that says how much of each list matches.                                                                                                |
| **Memory**   | Durable context CodeItLab recalls on its own: what is stored, what was recalled, and how to forget it. An empty list says what will put something in it.                                                                     |

## Profiles and policy

| Section        | What it does                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Uncensored** | A permissive _instruction profile_ for turns you send while it is on. It changes only the scaffolding CodeItLab adds; it cannot lift an upstream provider's policy, and a provider may still refuse. Providers the server reports as unsupported cannot be toggled. The audit trail only records something while the permissive profile is on. See [the policy notes](../codeitlab/MEMORY-REA-ROUTING.md). |
| **REA**        | Registers REA's MCP server and seeds its skill, then lists the health checks with the command that fixes each failing one. Auto-activate waits while REA itself is disabled.                                                                                                                                                                                                                               |
| **Ecosystem**  | Graft, Ponytail and the terse policy pack. _Install / refresh_ writes the MCP registration and policy files; it leaves anything already up to date alone, and the page lists exactly what it wrote.                                                                                                                                                                                                        |
| **Routing**    | How a turn picks a harness: automatic by task, or a fixed order you reorder with the keyboard. Fallback is a separate switch, and the page says which providers it would fall back to.                                                                                                                                                                                                                     |

## Access and privacy

| Section     | What it does                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Remote**  | Tailnet address, a temporary Cloudflare quick tunnel, and one-time phone links. Tunnel URLs are temporary; pairing links expire, so the page says both before you press anything. See [remote access](./remote-access.md).  |
| **Privacy** | The credentials proxy: secrets are masked by default, personal data is opt-in, and the scan box checks text for anything that should not leave the machine. See [the credentials proxy](../codeitlab/CREDENTIALS-PROXY.md). |

## Integrations

| Section    | What it does                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shorts** | The self-hosted OpenShorts engine: base URL, API key and clip jobs. The engine stays a separate service; CodeItLab configures and probes it. |
| **Crew**   | The self-hosted Rakazo engine, configured the same way.                                                                                      |
| **Search** | The self-hosted ModSearch engine, wired into the catalog like the other two.                                                                 |

Each of these pages names the open-source engine behind the CodeItLab label and
shows the setup command. _Retry_ probes one engine at a time and disables while a
probe is running.

## Work surfaces

| Section         | What it does                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Board**       | The kanban board's columns, the seven-day archive rule, and which tasks auto-review. A task starts a normal thread; the board never runs work itself. See [board](./kanban-board.md).                            |
| **Deploy**      | Saved deploy commands, run in a normal thread with the project's permissions. Nothing is deployed behind your back. See [deploy](./deploy.md).                                                                   |
| **Bots**        | Saved personas over normal threads, with their own chat box, memory and schedules. Local web chat works out of the box; Telegram needs a bot token you supply. See [bots](./bots.md).                            |
| **Team**        | Saved agent-team presets: one architect plus up to three workers, mixed providers. See [agent teams](./agent-teams.md).                                                                                          |
| **Context**     | Per-model context sizes, including a size you set by hand when a provider reports none. Estimates are marked `~`; a typo is refused instead of erasing the stored size. See [context sizes](./context-sizes.md). |
| **Goal budget** | A token budget per thread. It **warns**; it does not stop the thread. See [goal budget](./goal-budget.md).                                                                                                       |
| **Issues**      | A local issue list, with _Send to thread_ when a project is available. Issues stay on this machine. See [issues](./issues.md).                                                                                   |
| **Mood boards** | Colours, references and notes for design intent, sent to a thread when it needs a project. See [mood boards](./mood-boards.md).                                                                                  |
| **Sketch**      | Quick pointer layouts with keyboard undo and clear. Drawing needs a pointer; the canvas says so. See [sketch](./sketch.md).                                                                                      |
| **Wallpaper**   | The ambient background: built-in scene, a colour, or your own image URL, with an opacity slider. See [wallpaper](./wallpaper.md).                                                                                |
| **Marketplace** | Where the marketplace lives and what the app does not do with money. Payments happen on the marketplace site, not here. See [marketplace in the app](./marketplace.md).                                          |
| **Profile**     | Your declared interest domain and skillset, and the brief you can copy into a thread or a marketplace profile. See [your profile](./profile.md).                                                                 |

## What the panel deliberately does not do

- It does not write another harness's configuration files; it reads what they
  report and configures CodeItLab's own layer.
- It does not run a second execution path. Every button that starts work opens a
  normal thread.
- It does not claim the marketplace takes payments in the app, that budgets stop
  turns, or that the permissive profile can lift an upstream policy. Each of
  those pages says the limit in the same place the control lives.

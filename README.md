# CodeItLab

CodeItLab is an original-branded fork of an MIT-licensed agent harness (the original project is the repository's `upstream` git remote): an "agent harness control surface" that lets you drive the coding agents on your machine from a desktop app, a web app, and mobile clients. The engine is upstream v0.1.1; the product identity, identifiers, icons, and desktop packaging are CodeItLab's own.

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, CodeItLab can control them.

## What is different in this fork

- Product identity is **CodeItLab** with the **Beta** stage label: original near-black + phosphor green/cyan icon set, macOS bundle identifier `com.codeitlab.app`, and the `codeitlab://` URL scheme.
- Identifiers are CodeItLab's own across the whole stack: package scope `@codeitlab/*`, environment variables `CIL_*`, state under `~/.cil`, the project file `cil.json`, the `cil-context://` and `cil-thread://` deep links, and `cil`/`codeitlab` identifiers for protocols, database tables, assets, and commands. There is no alias layer for the upstream names: an existing upstream install keeps its old state directory and environment variables until you move them yourself.
- The desktop build is an unsigned local macOS app produced by this repository; see [docs/codeitlab/BUILD.md](./docs/codeitlab/BUILD.md).
- Startup time and idle memory are measured by a committed script (`node scripts/bench-startup.mjs`) and recorded, with the method and the desktop caveat, in [docs/codeitlab/PERFORMANCE.md](./docs/codeitlab/PERFORMANCE.md). No optimisation claim without a before/after row there.
- The panel follows a written UI quality bar (motion budget, reduced-motion, keyboard, honest states) in [docs/codeitlab/UI.md](./docs/codeitlab/UI.md).
- CodeItLab adds its own layer on top of the harnesses, on by default and without asking:
  - **Nexus** — one unified ACP surface: skills, sessions and MCP servers are ingested from every harness and merged into one catalog, and the merged MCP servers are injected into ACP sessions automatically. See [docs/codeitlab/NEXUS.md](./docs/codeitlab/NEXUS.md).
  - **Memory + REA + policy** — durable project/global memory recalled per turn, REA auto-activated for reverse-engineering work, and an optional permissive instruction profile (it cannot change an upstream provider's policy). See [docs/codeitlab/MEMORY-REA-ROUTING.md](./docs/codeitlab/MEMORY-REA-ROUTING.md).
  - **White-label agents** — every harness (Codex, Claude, Hermes, Qoder CLI, Cursor, Grok, OpenCode, Antigravity, Pi, Muse, custom ACP) appears as `CodeItLab <name>`; the first-run "Connect your agents" step lists every agent the computer already has, not just the two headline ones.
  - **OmniRoute** — multi-provider auto-routing scored on quota, smartness and speed, with an `enforcement` mode that actually switches the provider/model for a turn instead of only describing it. A background probe re-checks every provider every 30 minutes (binary, login, quota) and the router picks the best _working_ model per task — the fastest for quick questions, the smartest for coding/reasoning — inside the session.
  - **Auto router as a model choice** — the composer model picker has a pinned **Auto router** entry (_"Best model per task · all enabled apps"_). Pick it and every turn is routed across all models from every enabled harness, using the 30-minute quota probe and the task class; the thread keeps the choice (and the "Auto router" label) until you pick a concrete model. Opt-in, per thread, and the sentinel never reaches a provider session — a routed turn that cannot be served falls back to the first available provider's default model.
  - **Ecosystem** — Graft repo-graph MCP, Ponytail minimal-change rules and Caveman/terse output packs, seeded and rendered automatically; say "normal mode" in a thread to turn the packs off for that conversation. See [docs/codeitlab/ECOSYSTEM.md](./docs/codeitlab/ECOSYSTEM.md).
  - **Privacy firewall (credentials proxy)** — on by default, a local credentials proxy in the spirit of [Latet](https://github.com/Latet-AI/latet): before a prompt leaves for a provider, CodeItLab replaces API keys, passwords, tokens, private keys, personal data and `/private` blocks with deterministic format-preserving fakes (personal data is masked too, with a switch to turn it off; the real values are restored in the answer). App turns are masked in the dispatch path and fakes are restored in provider output before it is persisted; app-initiated generation (thread titles, commit messages, PR content, branch names, review guides) goes through the same mask/restore, and a loopback gateway does the same for CLI agents. The check runs locally with patterns plus the smallest feasible model (8,233 int8 weights, ~40 KB, no runtime). See [docs/codeitlab/CREDENTIALS-PROXY.md](./docs/codeitlab/CREDENTIALS-PROXY.md).
  - **Free agents, one click** — a curated **Agents** page lists the ACP agents that are actually free to start (Copilot Free, Cline free models, Kilo, Junie Lite, Qoder, Devin Free, Cursor Hobby, IBM Bob trial, plus the open-source tier: goose, OpenCode, pi, Qwen Code, Kimi, DeepAgents, siGit, VT Code and more), verified against each vendor's own pricing page. **Install** downloads the agent, adds it as a provider and enables it without a terminal; a **More ACP agents** section below the grid offers the same one-click install for every other entry in the official registry, and curated ones are badged **Free to start** in **Settings → Providers → Add provider**. See [docs/codeitlab/FREEMIUM-AGENTS.md](./docs/codeitlab/FREEMIUM-AGENTS.md).
  - **`codeitlab harness`** — the CLI harness-of-harnesses: `list`, `doctor` and `acp` over local, SSH and tailnet harnesses.
  - **Remote** — a tailnet-first remote page: it reports whether the host is reachable, lists the tailnet/LAN URLs, and mints a one-time phone pairing link as a QR code (no account needed). It can also run a managed **Cloudflare Tunnel** (start / stop / refresh URL) so a phone reaches the server over public HTTPS with no tailnet and no port forwarding, and the QR carries a hosted-PWA link for `app.codeitlab.com` (that hosted origin is not live yet, so use the direct link until it is). See [docs/codeitlab/REMOTE.md](./docs/codeitlab/REMOTE.md).
  - **Shorts, Crew, Search** — three whitelabel surfaces over self-hostable open-source engines (OpenShorts, Rakazo, ModSearch), with our own marks and settings, honest "Powered by" attribution, and automatic agent wiring (MCP registration for Shorts, a Search skill for ModSearch), and a Shorts clip-job flow (paste a link → the engine cuts it → clips with per-platform copy, polled in the tab). See [docs/codeitlab/INTEGRATIONS.md](./docs/codeitlab/INTEGRATIONS.md).
  - **PWA + vibe-coder marketplace** — the web app is installable from the browser (standalone window, offline shell, install prompt) instead of a store build; serve it over HTTPS and install it. The marketplace is a separate deployment: there, people who use the app declare they are open to paid work and businesses post the work they need; it ranks coders per job with reasons, holds the payment in escrow, and pays the coder after approval minus the platform fee (15% self-serve, 20% when the platform assists with matching). The app stays free. **Neither hosted deployment is live yet** - `app.codeitlab.com` does not answer and `codeitlab.com/market` returns 404 - so today this is code you run, not a URL you visit. See [docs/codeitlab/MARKETPLACE.md](./docs/codeitlab/MARKETPLACE.md) and [docs/codeitlab/PWA.md](./docs/codeitlab/PWA.md).
- Release builds are hardened against casual reverse engineering (no sourcemaps, `app.asar`, asar integrity, Electron fuses); see [release/verification/hardening.md](./release/verification/hardening.md) for exactly what is and is not protected.

## Installation

> [!WARNING]
> CodeItLab supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Desktop app (macOS, unsigned local build)

```bash
pnpm install
pnpm run build:desktop
pnpm --filter @codeitlab/desktop run package:codeitlab
open release/CodeItLab.app
```

The packaged app is written to `release/CodeItLab.app`. It is unsigned and ad-hoc signed for local use only. The exact commands and environment notes live in [docs/codeitlab/BUILD.md](./docs/codeitlab/BUILD.md).

### Command line

The bundled CLI is still named `codeitlab` (internal identifier kept from upstream). Build it, then run it from the repo:

```bash
pnpm run build:desktop
node apps/server/dist/bin.mjs
```

The server prints a pairing URL; open it to use the web app. `codeitlab service install`, `codeitlab update`, and `codeitlab --help` work the same way as upstream once the CLI is on your `PATH`.

## Some notes

We are very early in this fork. Expect bugs.

Upstream installers, release downloads, and package-manager entries install the upstream product, not CodeItLab. Use the local build commands above for this fork.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet. The short path is
below; [all user guides](./docs/user/README.md) lists every one of them.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Quick capture](./docs/user/quick-capture.md)
- [Agent teams](./docs/user/agent-teams.md)
- [Board](./docs/user/kanban-board.md)
- [Quests](./docs/user/quests.md)
- [Deploy](./docs/user/deploy.md)
- [Bots](./docs/user/bots.md)
- [Context sizes](./docs/user/context-sizes.md)
- [Mood boards](./docs/user/mood-boards.md)
- [Goal budget](./docs/user/goal-budget.md)
- [Issues](./docs/user/issues.md)
- [Wallpaper](./docs/user/wallpaper.md)
- [Tauri proposal](./docs/codeitlab/TAURI-PROPOSAL.md)
- [Marketplace in the app](./docs/user/marketplace.md)
- [Naming and ids](./docs/codeitlab/RENAME.md)
- [What CodeItLab does not do](./docs/codeitlab/LIMITS.md)
- [All constraint docs](./docs/codeitlab/README.md)
- [Your profile](./docs/user/profile.md)
- [Sketch](./docs/user/sketch.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run CodeItLab as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

CodeItLab uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/rumbis/codeitlab/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

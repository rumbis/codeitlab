# CodeitLab

CodeitLab (Beta) is an original-branded fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT): an "agent harness control surface" that lets you drive the coding agents on your machine from a desktop app, a web app, and mobile clients. The engine is T3 Code v0.1.1; the product identity, icons, and desktop packaging are CodeitLab's own.

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, CodeitLab can control them.

## What is different in this fork

- Product identity is **CodeitLab** with the **Beta** stage label: original near-black + phosphor green/cyan icon set, macOS bundle identifier `com.codeitlab.app`, and the `codeitlab://` URL scheme.
- Internal identifiers are deliberately unchanged so upstream fixes and existing state keep working: package names (`@t3tools/*`), environment variables (`T3CODE_*`), the CLI command (`t3`), and protocol/database identifiers.
- The desktop build is an unsigned local macOS app produced by this repository; see [docs/codeitlab/BUILD.md](./docs/codeitlab/BUILD.md).
- CodeitLab adds its own layer on top of the harnesses, on by default and without asking:
  - **Nexus** — one unified ACP surface: skills, sessions and MCP servers are ingested from every harness and merged into one catalog, and the merged MCP servers are injected into ACP sessions automatically. See [docs/codeitlab/NEXUS.md](./docs/codeitlab/NEXUS.md).
  - **Memory + REA + policy** — durable project/global memory recalled per turn, REA auto-activated for reverse-engineering work, and an optional permissive instruction profile (it cannot change an upstream provider's policy). See [docs/codeitlab/MEMORY-REA-ROUTING.md](./docs/codeitlab/MEMORY-REA-ROUTING.md).
  - **White-label agents** — every harness (Codex, Claude, Hermes, Qoder CLI, Cursor, Grok, OpenCode, Antigravity, Pi, Muse, custom ACP) appears as `CodeitLab <name>`; the first-run "Connect your agents" step lists every agent the computer already has, not just the two headline ones.
  - **OmniRoute** — multi-provider auto-routing scored on quota, smartness and speed, with an `enforcement` mode that actually switches the provider/model for a turn instead of only describing it. A background probe re-checks every provider every 30 minutes (binary, login, quota) and the router picks the best _working_ model per task — the fastest for quick questions, the smartest for coding/reasoning — inside the session.
  - **Auto router as a model choice** — the composer model picker has a pinned **Auto router** entry (_"Best model per task · all enabled apps"_). Pick it and every turn is routed across all models from every enabled harness, using the 30-minute quota probe and the task class; the thread keeps the choice (and the "Auto router" label) until you pick a concrete model. Opt-in, per thread, and the sentinel never reaches a provider session — a routed turn that cannot be served falls back to the first available provider's default model.
  - **Ecosystem** — Graft repo-graph MCP, Ponytail minimal-change rules and Caveman/terse output packs, seeded and rendered automatically; say "normal mode" in a thread to turn the packs off for that conversation. See [docs/codeitlab/ECOSYSTEM.md](./docs/codeitlab/ECOSYSTEM.md).
  - **Privacy firewall (credentials proxy)** — opt-in local credentials proxy in the spirit of [Latet](https://github.com/Latet-AI/latet): before a prompt leaves for a provider, CodeitLab replaces API keys, passwords, tokens, private keys, personal data and `/private` blocks with deterministic format-preserving fakes. App turns are masked in the dispatch path; a loopback gateway does the same for CLI agents and restores real values in answers. The check runs locally with patterns plus the smallest feasible model (8,233 int8 weights, ~40 KB, no runtime). See [docs/codeitlab/CREDENTIALS-PROXY.md](./docs/codeitlab/CREDENTIALS-PROXY.md).
  - **`codeitlab harness`** — the CLI harness-of-harnesses: `list`, `doctor` and `acp` over local, SSH and tailnet harnesses.
  - **Remote** — a tailnet-first remote page: it reports whether the host is reachable, lists the tailnet/LAN URLs, and mints a one-time phone pairing link as a QR code (no account needed). See [docs/codeitlab/REMOTE.md](./docs/codeitlab/REMOTE.md).
  - **Shorts, Crew, Search** — three whitelabel surfaces over self-hostable open-source engines (OpenShorts, Rakazo, ModSearch), with our own marks and settings, honest "Powered by" attribution, and automatic agent wiring (MCP registration for Shorts, a Search skill for ModSearch), and a Shorts clip-job flow (paste a link → the engine cuts it → clips with per-platform copy, polled in the tab). See [docs/codeitlab/INTEGRATIONS.md](./docs/codeitlab/INTEGRATIONS.md).
- Release builds are hardened against casual reverse engineering (no sourcemaps, `app.asar`, asar integrity, Electron fuses); see [release/verification/hardening.md](./release/verification/hardening.md) for exactly what is and is not protected.

## Installation

> [!WARNING]
> CodeitLab supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
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
pnpm --filter @t3tools/desktop run package:codeitlab
open release/CodeitLab.app
```

The packaged app is written to `release/CodeitLab.app`. It is unsigned and ad-hoc signed for local use only. The exact commands and environment notes live in [docs/codeitlab/BUILD.md](./docs/codeitlab/BUILD.md).

### Command line

The bundled CLI is still named `t3` (internal identifier kept from upstream). Build it, then run it from the repo:

```bash
pnpm run build:desktop
node apps/server/dist/bin.mjs
```

The server prints a pairing URL; open it to use the web app. `codeitlab service install`, `codeitlab update`, and `codeitlab --help` work the same way as upstream once the CLI is on your `PATH`.

## Some notes

We are very early in this fork. Expect bugs.

Upstream T3 Code installers, release downloads, and package-manager entries install the upstream product, not CodeitLab. Use the local build commands above for this fork.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run CodeitLab as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

CodeitLab uses Vite+ so you'll need to install the global `vp` command-line tool.

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

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

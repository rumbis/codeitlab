# Memory — CodeitLab white-label rules

Everything a user can read carries the CodeitLab brand. This file is the map of
where that happens so future rounds do not re-derive it.

## Product name

- Canonical spelling is **`CodeitLab`** (never `CodeiLab`). The app ships as
  `CodeitLab (Beta)` with bundle id `com.codeitlab.app`.
- Upstream "T3 Code" product strings are gone from source (`grep -rn "T3 Code"
apps packages` → 0). Keep technical identifiers untouched: `@t3tools/*`
  package names, `T3CODE_*` env vars, the `~/.t3` data home, and `t3.codes`
  infrastructure URLs.
- The CLI command is **`codeitlab`** (`npx codeitlab pair`), from the npm
  package `codeitlab` and the desktop-installed shim `codeitlab`/`codeitlab.cmd`.
  The legacy `t3` command/package is still _accepted_ (lookups, shims, npm
  installs) but never created. Constants live in
  `packages/contracts/src/cliBranding.ts` (`CLI_BINARY_NAME`,
  `CLI_BINARY_NAMES`) and `apps/server/src/cli/cliName.ts`.
- New user-facing copy should say "CodeitLab", not "the app" or "T3".

## Agent names

`packages/contracts/src/agentBranding.ts`:

```ts
export const AGENT_BRAND_PREFIX = "CodeitLab";
export function codeitlabAgentLabel(displayName, fallback = "Agent"): string;
```

- Idempotent: `"CodeitLab Hermes"` stays as-is, `"hermes"` → `"CodeitLab hermes"`.
- Blank/undefined → `"CodeitLab Agent"`.
- Model ids are **not** branded: `claude-opus-5-5`, `gpt-6.1-sol`, Hermes model
  slugs stay real because routing scores, pricing tables and saved model
  selections key on them.

Branding is applied at boundaries, not per component:

1. `buildServerProvider` (provider-core) — every live snapshot draft.
2. `correlateSnapshotWithSource` (server `ProviderRegistry`) — the white-label
   boundary for every snapshot published to web, mobile, desktop, routing, Nexus.
3. `RoutingService` — health/catalog display names.
4. UI fallbacks (web `providerDriverMeta`, `usageProviders`, onboarding, provider
   instance cards; mobile `modelOptions`) for labels that never reach a snapshot.

## Onboarding "Connect your agents"

`apps/web/src/components/onboarding/WelcomeWizard.tsx`:

- `PRIMARY_AGENT_DRIVERS = ["codex", "claudeAgent"]` get the dedicated setup
  cards (ChatGPT subscription / existing CLI).
- **Every agent the machine already has is a first-class card in the same list**
  (`[data-onboarding-active-agents]`, each card carrying `data-onboarding-agent`
  and `data-onboarding-agent-state`). "Has" means the instance is enabled in
  settings or the probe reports ready/attention/sign-in, so a local Hermes or an
  ACP-registry Qoder CLI can no longer hide under a footnote.
- Only agents that are disabled or not installed land in the secondary
  "More supported agents" list; the copy says "Not enabled yet" and points at
  Settings → Providers. `otherAgentRank` still sorts ready-first.
- Card names always pass through `codeitlabAgentLabel`, so a driver that
  publishes a raw vendor name still renders as `CodeitLab <name>`. The ACP
  registry client labels are branded at the source too
  (`packages/provider-acp-registry/src/client.ts`: `CodeitLab Hermes`,
  `CodeitLab ACP`), and mobile usage labels use the same helper.
- Agents without an in-app login flow show "Sign in in Settings" /
  "Install in Settings" instead of a dead terminal button.
- The step is reachable at `/welcome#agents:<environmentId>`.
- Regression test: `WelcomeWizard.browser.test.tsx` — "lists the agents the
  computer already has in the main list, under the CodeitLab brand".

## Our own npm package (round 12)

Upstream publishes `t3` as a launcher that downloads the CLI archive from its
GitHub Release. We publish **`codeitlab`** the same way:

- `scripts/npm-launcher/codeitlab.mjs` — launcher. Resolution order:
  `CODEITLAB_CLI_PATH` → cached `<home>/runtime/versions/<version>` →
  download from `CODEITLAB_RELEASE_BASE_URL` (SHA256SUMS verified) → the
  checkout it runs from (`apps/server/dist/bin.mjs`). Errors point at the
  desktop app / checkout / `CODEITLAB_CLI_PATH`.
- `scripts/npm-launcher/codeitlab-bin.mjs` — `dist/bin.mjs` re-entry for
  background services (same IPC contract as upstream).
- `scripts/build-npm-launcher.ts build-codeitlab-cli-package --version <v> --output-dir <dir>`
  builds `codeitlab/` and `codeitlab.tgz` (manifest: name `codeitlab`, bin
  `codeitlab`, MIT, repository `rumbis/codeitlab`).
- `.github/workflows/release.yml` `publish_cli` builds and publishes it with
  `apps/server/scripts/cli.ts publish --package-name codeitlab`.
- `npx codeitlab` runs the CLI (`USAGE codeitlab <subcommand>`), and the npm
  install is what `T3CODE_NPM_LAUNCHER_PATH` points at so `codeitlab update`
  can repair it.

## Verification recipe

1. Source: `T3CODE_HOME=<tmp> node apps/server/src/bin.ts --auto-bootstrap-project-from-cwd <project>`
   with a settings file listing the provider instances you want to see.
2. Pair with a fresh one-time token, open `/welcome#agents:<envId>`, dump
   `section` cards and the Providers page text.
3. Expect every agent name to start with `CodeitLab ` and no `T3 Code` text.
4. Packaged proof: grep the asar for `CodeitLab Agent`/`codeitlabAgentLabel`
   markers and assert no `T3 Code` in our own chunks (vendor deps may still
   contain their own strings — report them separately).

## Second sweep — the "T3 <noun>" names (round 9)

The first sweep removed "T3 Code"; a second pass (167 files, 467 replacements)
removed the remaining human-facing "T3 <noun>" product names:

| before                  | after                 |
| ----------------------- | --------------------- |
| T3 Connect              | CodeitLab Connect     |
| T3 account / T3 Account | CodeitLab account     |
| T3 thread(s)            | CodeitLab thread(s)   |
| T3 MCP                  | CodeitLab MCP         |
| T3 server               | CodeitLab server      |
| T3 home                 | CodeitLab home        |
| T3 identity             | CodeitLab identity    |
| T3 App                  | CodeitLab App         |
| T3 could not …          | CodeitLab could not … |

Two traps: JSX text split across lines (`… or use T3\nConnect.`) is not matched
by a line-based search — grep for `T3$` as well. And "T3 Tools" is the legal
entity / MIT attribution: never rename it (Info.plist copyright, packager
attribution, marketing tweets quoting users).

## Raw provider ids on Routing/Nexus (round 10)

Surfaces that never see a snapshot (routing health, routing history, Nexus
session badges) only have ids like `hermes` or `acpRegistry_qoder_cli`.
`apps/web/src/codeitlab/providerLabels.ts` brands them:

- `codeitlabProviderLabel(id)` → `CodeitLab Qoder CLI`, `CodeitLab Hermes`, and
  humanized fallbacks for unknown ids (`my-agent_2` → `CodeitLab My Agent 2`).
- `codeitlabProviderName(name)` → brands a snapshot/health name and **strips an
  existing `CodeitLab ` prefix before re-mapping**, so the server's
  `CodeitLab hermes` becomes `CodeitLab Hermes`.
- `codeitlabProviderKindLabel(kind)` → short technical column labels
  (`hermes` → `Hermes`, `acpRegistry` → `ACP`, `claudeAgent` → `Claude`).

## Shipped artifact (round 11)

`release/CodeiLab.app` → `app.asar` **88,959,229 B**, 2,496 entries, `du` 427M,
mtime 04:13, integrity hash `df1e6e73…`; bundle greps: `T3 Connect` 0,
`CodeitLab Connect` 189+, `T3 Code` 0 (only the MIT attribution line in the
packaged root `package.json`), `CodeiLab` 0. Packaged proof:
`release/verification/codeitlab-onboarding-agents.png`,
`codeitlab-providers-whitelabel.png`, `codeitlab-routing-names-final.png`,
`codeitlab-remote-whitelabel.png`.

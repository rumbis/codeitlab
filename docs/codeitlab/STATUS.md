# CodeItLab — status of the whole picture

This is the honest map: every promise in the objective, where it lives, and what
proves it. Counts live only in the verification snapshot at the end, because a
number in the intro goes stale the first time someone adds a test.

## What CodeItLab is today

A fork of an MIT-licensed agent harness that brands everything a person sees as
**CodeItLab**. User-facing names are `codeitlab`/`cil`, `CIL_*` environment
variables and `~/.cil`; the legacy `codeitlab` command, `CIL_*` names and `~/.cil`
are accepted for existing installs. Workspace package names (`@codeitlab/*`) and
protocol/database identifiers are the remaining internal names. It is two
products on one repository:

1. **The app** — a local-first ACP harness with a routing layer, memory, REA,
   Nexus, Studio (decks and video), Shorts, a settings panel, an uncensored
   toggle and a CLI published as `npx codeitlab`.
2. **The marketplace** (`apps/marketplace`) — a zero-dependency, server-rendered
   marketplace where people who use the app get paid by businesses for work,
   with escrow, evidence, reputation, a 15%/20% fee and an operator queue.

## Objective → where it lives → evidence

| Promise                                                                                        | Implementation                                                                                                         | Evidence                                                                                   |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unified harness for every ACP (Hermes, Qoder, Claude, Codex, Cursor, Grok, Muse, OpenCode, Pi) | `packages/provider-acp*`, `apps/server/src/codeitlab/integrations`, harness matrix                                     | `docs/codeitlab/HARNESS-MATRIX.md`, 33 CodeItLab test files                                |
| Skills, sessions and MCP from every ACP                                                        | `apps/server/src/codeitlab/ecosystem`, `sessions`, `mcp`                                                               | `docs/codeitlab/ECOSYSTEM.md`, `SESSION-HISTORY.md`                                        |
| Welcome step listing active agents                                                             | web onboarding + agents panel                                                                                          | `apps/web/src/codeitlab/agents*`                                                           |
| 3D/animated UI, effects, SFX                                                                   | `ambientScene`, `effectsSettings`, `audio`                                                                             | `docs/codeitlab/FEATURE-SPEC.md`                                                           |
| DeepSeek-like memory                                                                           | `apps/server/src/codeitlab/memory`, `packages/codeitlab/src/memory.ts`                                                 | `MEMORY-WHITELABEL.md`                                                                     |
| Own panel                                                                                      | `/settings/codeitlab/*` (24 sections)                                                                                  | `apps/web/src/codeitlab/panel.ts`                                                          |
| Uncensored toggle                                                                              | `/settings/codeitlab/uncensored`                                                                                       | same panel registry                                                                        |
| REA (evidence-driven review)                                                                   | `packages/codeitlab/src/rea.ts`, `apps/server/src/codeitlab/rea`                                                       | `REA-EVIDENCE.md`                                                                          |
| Quota-aware router (OmniRoute idea)                                                            | `apps/server/src/codeitlab/routing` (health, scoring, classify)                                                        | `MEMORY-REA-ROUTING.md`                                                                    |
| Studio: decks and video from code                                                              | `packages/codeitlab/src/studio.ts`, `apps/web/src/components/studio`                                                   | `STUDIO.md`                                                                                |
| Shorts clip jobs, OpenShorts/Rakazo/ModSearch                                                  | `apps/server/src/codeitlab/integrations` (clip jobs, tools), settings section                                          | integrations + quests tests, `INTEGRATIONS.md`                                             |
| Model-picker search                                                                            | `apps/web/src/codeitlab/autoRouterLabel.ts`, model picker                                                              | web tests                                                                                  |
| Own npm package                                                                                | `scripts/npm-launcher/codeitlab.mjs` → `codeitlab@0.1.0` on npm, `0.2.0` built                                         | `codeitlab@0.2.0` tarball (7 files) + release `v0.2.0` it downloads from                   |
| Publish guide + one command                                                                    | `docs/codeitlab/PUBLISH-NPM.md`, `scripts/publish-codeitlab-cli.sh`                                                    | docs                                                                                       |
| GitHub repo                                                                                    | `github.com/rumbis/codeitlab`, `main` is orphan snapshots                                                              | `git log origin/main`                                                                      |
| Marketplace with escrow                                                                        | `apps/marketplace/src/server/engagements.ts`, migrations 1–23                                                          | `apps/marketplace` suite (measured in the snapshot)                                        |
| Very secure marketplace                                                                        | see invariants below                                                                                                   | tests + `SECURITY` doc                                                                     |
| 15–20% fee, 0% to post/apply/refund                                                            | `FEE_TIER_BPS` (1500/2000), `platformFeeCents`                                                                         | `/numbers`, `/how-it-works` (copy asserted against code)                                   |
| Gamification that teaches                                                                      | quest board derived from real state, one lesson per quest                                                              | `apps/marketplace/src/server/quests.ts`                                                    |
| Users declare interest + skillset                                                              | coder profile fields, directory filters, coder alerts                                                                  | profiles, `/coders`                                                                        |
| Work for people with vision / companies without time                                           | matching with reasons, templates, saved searches, coder alerts, auto-release                                           | `MATCH_WEIGHTS`, `jobTemplates.ts`, `savedSearches.ts`, `coderAlerts.ts`, `autoRelease.ts` |
| Bridge the fear between human and AI                                                           | public "Where AI is — and is not" section: arithmetic ranking, no model approves/pays                                  | `/how-it-works#ai`, test asserted                                                          |
| Rust for web security                                                                          | Rust does not make a web app safe by itself; used only where it pays (WASM sandbox candidate, media/crypto throughput) | `VISION.md` §4.3                                                                           |

## Parity waves (the second track)

The parity build adds surfaces a practitioner expects, each on top of an existing
execution path rather than a second one. A surface that cannot do the real thing yet
says so in the UI and in its user doc.

| Wave | Item                                               | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verified by                                                                                                                                                                                        |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | G11 measured startup baseline                      | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `scripts/bench-startup.mjs`, `PERFORMANCE.md`                                                                                                                                                      |
| 0    | G7 quick overlay launcher                          | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `QuickOverlayLauncher.browser.test.tsx`, `apps/desktop/src/window/QuickOverlayShortcut.test.ts`                                                                                                    |
| 1    | G2 agent teams                                     | done: presets, run cards with one row per worker, synthesis, aggregated changed files, composer entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `packages/codeitlab/src/team.test.ts`, `apps/web/src/codeitlab/team.test.ts`, `CodeItLabTeamPage.browser.test.tsx`, `CodeItLabTeamRunCard.browser.test.tsx`, `ComposerTeamsEntry.browser.test.tsx` |
| 1    | G1 kanban board                                    | done: board UI, migration 068, repository, `CodeItLabTasksService`, ws methods, database-first dual read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | board schema/actions tests, `CodeItLabTasks.test.ts`, `TasksService.test.ts`, migration tests, `CodeItLabBoardPage.browser.test.tsx`, sidebar chip tests                                           |
| 2    | G5 deploy menu                                     | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `packages/codeitlab/src/deploy.test.ts`, `CodeItLabDeployPage.browser.test.tsx`                                                                                                                    |
| 2    | G3 bots                                            | local chat done; Telegram and per-bot schedules need a bot token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `packages/codeitlab/src/bots.test.ts`, `CodeItLabBotsPage.browser.test.tsx`                                                                                                                        |
| 3    | G12 per-model context size                         | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `packages/codeitlab/src/context.test.ts`, `apps/web/src/lib/contextWindow.test.ts`, `CodeItLabContextPage.browser.test.tsx`                                                                        |
| 3    | G8 goal budget                                     | done (a warning, never a stop)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `packages/codeitlab/src/budget.test.ts`, `CodeItLabBudgetPage.browser.test.tsx`                                                                                                                    |
| 3    | G9 issues                                          | local list done; no GitHub sync                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `packages/codeitlab/src/issues.test.ts`, `CodeItLabIssuesPage.browser.test.tsx`                                                                                                                    |
| 3    | G6 mood boards + sketch                            | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `packages/codeitlab/src/moodboard.test.ts`, `sketch.test.ts`, `CodeItLabMoodBoardPage.browser.test.tsx`, `CodeItLabSketchPage.browser.test.tsx`                                                    |
| 4    | G10 wallpapers                                     | done, opt-in, contrast-safe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `packages/codeitlab/src/wallpaper.test.ts`, `CodeItLabWallpaperPage.browser.test.tsx`                                                                                                              |
| 4    | G4 sandbox: Setup surface                          | done: backend matrix (Tart/Docker/Podman/WSL2), five honest states, probe, consent-gated install, copy-command for everything the app will not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `packages/codeitlab/src/sandbox.test.ts`, `apps/server/src/codeitlab/sandbox/SandboxService.test.ts`, `CodeItLabSetupPage.browser.test.tsx`                                                        |
| 10   | G4 sandbox: health probe + "Sandbox ready"         | done: `SandboxService.health` asks each installed backend the question its version cannot (Tart VM list, Docker/Podman info, WSL distributions), declares those checks in the matrix, keeps a missing binary at `not-installed` instead of a second failure, never spawns an unsupported backend, and carries the sanitized failing line. The Setup page renders the server's "Sandbox ready" / "Sandbox not ready" sentence with every check; ready still means the **backend**, never a running sandbox                                                                                                                                                                                       | `packages/codeitlab/src/sandbox.test.ts` (7 health tests), `apps/server/src/codeitlab/sandbox/SandboxService.test.ts` (6 health tests), `CodeItLabSetupPage.browser.test.tsx`                      |
| 11   | G4 sandbox: the machine (create / run / remove)    | done: one machine per backend named `codeitlab-sandbox`; Docker and Podman are end-to-end (detached create, `exec /bin/sh -lc`, `rm -f`), Tart is cloned but honestly stays `stopped` with the `tart run` command because the app does not keep a foreground VM in the background yet; create/remove need `consent: true`, create is idempotent, a missing Tart image returns the `tart pull` command instead of downloading, commands are capped (4k chars, 10s default / 120s max) and output is tail-capped, ANSI-stripped and env-redacted                                                                                                                                                  | `packages/codeitlab/src/sandbox.test.ts` (3 machine tests), `apps/server/src/codeitlab/sandbox/SandboxService.test.ts` (15 machine/run tests), `CodeItLabSetupPage.browser.test.tsx`               |
| 12   | G4 sandbox: agent tools on the existing MCP server | done: `cil_sandbox_status` (read-only probe: backend readiness, machine state, start command) and `cil_sandbox_run` (one command inside the running machine, exit code + output tail + duration) are registered on the app's own `/mcp` server, so every provider session already reaches them; run needs a live full-access thread, and create/remove stay human-only because consent is not something an agent can give                                                                                                                                                                                                                                                                       | `apps/server/src/mcp/toolkits/sandbox/handlers.test.ts` (5), `toolkits/worktree/registration.test.ts`                                                                                              |
| 12   | G4 sandbox: turns inside it                        | not started: the agent runs on the host and calls the sandbox through tools; the session itself does not run inside the machine                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                                                                                  |
| 5    | Goal B: thread token usage in the picker chip      | done: the composer chip reads the thread this route points at (useThreadRouteRef + useThreadProjection) through threadSessionContextUsage, so it renders `12,000 / 200,000 tokens` beside the task class once the thread has run; a thread that never reported usage shows no number instead of 'not used yet'. The Models page is not inside a thread, so it still says where the number lives. Both surfaces fold the same catalog through buildSessionUnderstanding, so the class and the numbers cannot drift                                                                                                                                                                               | `modelsSession.test.ts` (17, +4 threadSessionContextUsage), `SessionUnderstandingChip.browser.test.tsx` (8, +2)                                                                                    |
| 5    | Goal B: thread token usage in the picker chip      | partial: the chip renders used/limit when a source exists and the Models page says where that number lives, but `ProviderModelPicker` has no thread projection to pass it, so the composer shows the class and reason only                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                  |
| 6    | Goal C: autorouter that explains and defers        | done: "Why this model" table with per-candidate quota/smartness/speed/score and a picked badge, per-task overrides (`routing.taskOverrides`) honored before scoring with an honest fallback when the target is unusable, delegated provider kinds (`routing.delegatedProviderKinds`) plus OmniRoute marked `delegated`, and enforcement still refusing to swap a thread's pinned model                                                                                                                                                                                                                                                                                                          | `apps/server/src/codeitlab/routing/RoutingOverrides.test.ts`, `CodeItLabRoutingExplain.browser.test.tsx`                                                                                           |
| 6    | Goal C: detecting a provider's own router          | not possible today: no provider exposes "I route internally" over its API, so delegation is declared by the user and the limit says so                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                                                                                                                  |
| 7    | Goal D: server-side XP/level/streak ledger         | done: `CodeItLabXpSettings` + pure `codeitlabXp` in `packages/codeitlab/src/xp.ts`, `XpService` (`codeitlab.xp.state` / `codeitlab.xp.record`) stamps the server clock and dedupes by event id, so a retry cannot farm XP; XP = 10/turn + 50/task + 5 per UTC day that had one, level n at 50·(n−1)·n                                                                                                                                                                                                                                                                                                                                                                                           | `xp.test.ts` (14), `XpService.test.ts` (6)                                                                                                                                                         |
| 7    | Goal D: quest XP from the board                    | done: completing a board task records `quest-completed` (50 XP) from the board service itself, so every transport that saves a task emits it; the event id is `task:<id>`, so the ledger's dedupe counts a quest once and a reopened task earns nothing extra; the board write never waits for the ledger (a failed XP write is logged and the card still moves); the board page refreshes the ring when a card lands in Completed, so the number moves without a reload                                                                                                                                                                                                                        | `TasksService.test.ts` (5, +4 quest XP), `CodeItLabBoardPage.browser.test.tsx` (37, +1), `XpService.test.ts` (6)                                                                                   |
| 8    | Goal E: the app talks to your own marketplace      | done: marketplace gained account API tokens (`POST/GET/DELETE /api/auth/tokens`, Bearer accepted for account endpoints, hashes only) and per-engagement messages (`GET/POST /api/engagements/:id/messages`, participants only, cursor, evidence, allowed in every status); the app gained `EngagementsService` (URL in settings, token in the vault, injectable HTTP), five RPCs, and an honest read-only bridge that names the missing piece instead of faking an empty list                                                                                                                                                                                                                   | `apps/marketplace/test/api-tokens.test.ts` (8), `engagement-messages.test.ts` (7), `EngagementsService.test.ts` (17), `engagements.test.ts` (17)                                                   |
| 9    | Goal E: delivery + handoff from a thread           | done: `draftDelivery` resolves the thread's working tree on the server, reads `GitManager.localStatus` and composes a note (files, +/−, branch) and a four-section client handoff (built / runs / cost / **not** done) from git facts only; `deliver` validates the note and up to five http(s) evidence links and posts `{deliveryNote, deliveryEvidence}` to `/api/engagements/:id/deliver`. The dialog shows the draft, lets the coder switch to the handoff, edit either, and sends only on **Deliver**; a refusal is shown verbatim and the draft kept. Model-voiced handoff is the remaining slice                                                                                        | `EngagementsService.test.ts` (27), `engagements.test.ts` (17)                                                                                                                                      |
| 13   | Goal E: model-voiced handoff                       | done: new `generateDeliveryHandoff` on `ProviderTextGeneration` (prompt pins the four sections, forbids claiming tests/deploy/release, summary ≤160 chars, body ≤4,000; `fromRunner` providers and Muse implement it, ACP says unsupported); `Engagements.deliveryHandoff` drafts from the same git facts, asks the thread's model, and returns `{summary, body, generated, model, reason, draft}` — no selection or a failed call returns the deterministic handoff with the reason. Still cannot know test results or deploys                                                                                                                                                                 | `textGenerationOperations.test.ts` (2), `textGenerationPrompts.test.ts` (+3), `EngagementsService.test.ts` (32, +5), dialog browser tests                                                          |
| 14   | G4 sandbox: start and stop the machine             | done: `machineStart`/`machineStop` on the sandbox service; Tart Start backgrounds `tart run --no-graphics` with nohup and then believes `tart list` (spawn exit code is not proof), Docker/Podman use their own start/stop, both re-read state and require `consent: true`, start is idempotent ("already running"), stop says when nothing runs, and a VM that did not boot is reported as stopped instead of success. Setup card gains Start/Stop; the agent still cannot start the machine (consent is human)                                                                                                                                                                                | `SandboxService.test.ts` (37, +7 start/stop), `CodeItLabSetupPage.browser.test.tsx`, `toolkits/sandbox/handlers.test.ts`                                                                           |
| 15   | G4 sandbox: Windows says what is actually missing  | done: a readiness answer now becomes a verdict in one pure place (`sandboxReadinessResult`) instead of "exit code 0". WSL was the lie: `wsl --list --quiet` exits 0 with no distribution, so Windows said "Sandbox ready" with nothing to run work in. The list is decoded (UTF-16LE NULs stripped, BOM/CRLF handled, the "no installed distributions" sentence is not a distro) and an empty list fails the check with `wsl --install -d Ubuntu`; details stay sanitized on the server side                                                                                                                                                                                                    | `sandbox.test.ts` (26, +5 decode/verdict), `SandboxService.test.ts` (39, +2 Windows)                                                                                                               |
| 16   | G4 sandbox: the thread's code inside the machine   | done: `machineSync` copies the calling thread's git-tracked files into `/work` inside the running machine — host `git archive HEAD` piped through `base64`, that text on stdin, `base64 -d` piped into `tar -xf -` in the machine — so `cil_sandbox_run` can build or test the project instead of only running `uname -a`. Caps (500 files / 8 MB) are checked before the machine is touched; a stopped machine refuses with the start sentence; an archive failure is an honest result, not a thrown error; gitignored files never leave the host and nothing comes back out. Exposed as the `cil_sandbox_sync` MCP tool (full-access thread only); no RPC because Setup has no thread context | `SandboxService.test.ts` (45, +6 sync), `toolkits/sandbox/handlers.test.ts` (10, +5), MCP registration test, `sandbox.test.ts` (29, +3 caps)                                                       |
| 17   | Goal D: a completed card is worth XP               | done: the board is the second real XP source. `TasksService.upsert` resolves `XpService` per call (`Effect.serviceOption`, so a layer without the ledger still works), records `quest-completed` when the saved task is in Completed, and treats the ledger as a bonus: a refused write is logged, never thrown, and the card still saves. The event id is the task's, so the ledger's own dedupe is the anti-farming rule; the board page calls `xp.refresh()` after a completing move so the ring moves without a reload. The fixture that had been failing since migration 068 (`completed_at` NOT NULL) is fixed, so the board database path is green                                       | `TasksService.test.ts` (5, +4), `CodeItLabBoardPage.browser.test.tsx` (37, +1)                                                                                                                     |

Deliberate limits, stated in the UI as well as the docs: a budget never cancels a run;
bot memory is curated by the user, not written by the agent; issues are local and
never fetched; changed files cover the run's own checkpoints and say so.

## Marketplace security invariants (each has a test)

- **Auth**: email-code only, hashed codes with per-account and per-IP limits,
  attempt caps, hashed session tokens, revocation, sign-in alerts, admin
  session revocation, account suspension.
- **Money**: integer cents; escrow charged once per job (partial unique index +
  compare-and-set transitions); fee recorded only on approval; idempotency keys
  to the provider; append-only ledger; reconciliation endpoint and admin badge;
  CSV with formula-injection guard; full refunds.
- **Web**: CSP `default-src 'self'`/`script-src 'self'`, `frame-ancestors
'none'`, `form-action 'self'`, permissions policy, COOP, HSTS behind HTTPS,
  CSRF via Origin/Referer, open-redirect-safe redirects, 64 KiB socket body cap,
  server timeouts, escaped output everywhere.
- **Abuse**: sliding-window rate limits on charge/transition/invite/report/post/
  apply; private messages refuse off-platform contact details before an
  engagement; reports queue with audited resolutions; operator snapshot.
- **Privacy**: one-file export, deletion that scrubs personal data but keeps the
  ledger balanced, no trackers, no third-party scripts.
- **Ops**: `doctor` preflight (mail, payments, admin token, cookies, proxy,
  database, scheduling, rate-limit typos), maintenance loop, health with schema
  version, security.txt, sitemap, robots.

## Verified this session

| Check                                                                             | Result                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vp test run apps/marketplace`                                                    | **302 passed** (68 files), including a real-process boot of `main.ts`                                                                                              |
| `vp test run packages/codeitlab apps/server/src/codeitlab apps/web/src/codeitlab` | **374 passed, 1 skipped** (44 files)                                                                                                                               |
| `tsc-rs --noEmit` (marketplace)                                                   | clean                                                                                                                                                              |
| `vp lint apps/marketplace`                                                        | **0 warnings, 0 errors**                                                                                                                                           |
| `vp lint` (298 CodeItLab + marketplace files)                                     | **0 warnings, 0 errors**, `vp fmt --check` clean                                                                                                                   |
| `vp test run scripts/build-npm-launcher.test.ts`                                  | **3 passed** (download, SHA256 verify, cache, run — realpath-safe on macOS)                                                                                        |
| `vp test run packages/codeitlab/src/credentials …`                                | **33 passed** — secrets masked by default, personal data opt-in, explicit rule gating                                                                              |
| `vp test run …/credentials … RunExecutionService.test.ts`                         | **75 passed** — masking, restore round trip, restore at the ingestion boundary                                                                                     |
| `vp test run apps/server/src/textGeneration`                                      | **98 passed** — app-initiated generation masks credentials and restores results                                                                                    |
| `vp lint` (CodeItLab code)                                                        | **0 warnings, 0 errors** (packages/codeitlab, apps/server/src/codeitlab, apps/web/src/codeitlab)                                                                   |
| Marketplace boot with a file DB                                                   | `/`, `/jobs`, `/coders`, `/how-it-works`, `/numbers`, `/sitemap.xml`, `/robots.txt`, `/.well-known/security.txt`, `/manifest.webmanifest`, `/health` → all **200** |
| npm launcher build                                                                | package tree + tarball built; `codeitlab --version` → `codeitlab v0.1.0`                                                                                           |
| Privacy firewall defaults                                                         | **on** for secrets and personal data; app turns, app-initiated generation and the gateway all mask and restore                                                     |
| Remote `main`                                                                     | orphan snapshot, always a superset of the validated tree                                                                                                           |

| `vp test run` — parity feature units (board, bots, budget, context, deploy, issues, mood, wallpaper, team, context window) | **89 passed** (16 files) |
| `vp test run --project browser` — CodeItLab surfaces (board, bots, deploy, context, mood, budget, issues, wallpaper, team run, sidebar chips) | **66 passed** (15 files) |
| `tsc-rs --noEmit` (`@codeitlab/web`) after each parity feature | clean |

### Recovery round (2026-10-26, brand normalization + marketplace apply)

The fork still spelled its own name two ways: an early bulk rename left the
lowercase-i variant in 745 files, and the desktop build config still shipped
upstream names - the `CodeItLab` product name, the DMG title, the Finder permission
strings and the `CodeItLab-Code-<version>-<arch>` artifact file name. Both are fixed,
and a drift test now fails the build if the old product name returns to that file.

| Check                                                            | Result                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand normalization                                              | 749 files changed; every standalone occurrence is `CodeItLab` (capital `I`), 0 leftovers                                                     |
| Shipped names                                                    | product name, nightly name, DMG title, Info.plist usage strings, protocol display name, app description, CLI description, artifact file name |
| `renameDrift.test.ts`                                            | **2 passed**; walks every tracked path and text file in the checkout for the retired brand                                                   |
| `docsStructure.test.ts` + doc links                              | **10 passed**; `node scripts/check-doc-links.mjs` -> 57 links, 0 problems                                                                    |
| `scripts/build-desktop-artifact.test.ts`                         | **84 passed** with `ELECTRON_RUN_AS_NODE` unset (see below)                                                                                  |
| `scripts/install.test.ts` + `build-npm-launcher.test.ts`         | **87 passed, 2 skipped**                                                                                                                     |
| Brand-sensitive (89), desktop (22), mobile (12)                  | green                                                                                                                                        |
| `tsc-rs --noEmit` web / server                                   | web clean; server at its pre-existing 118-error baseline in four unrelated suites                                                            |
| `vp lint` on every touched file                                  | 0 warnings, 0 errors                                                                                                                         |
| `pnpm run build:desktop`                                         | exit 0                                                                                                                                       |
| `package-codeitlab-app.mjs --output /Applications/CodeItLab.app` | exit 0; `CFBundleName=CodeItLab`, `com.codeitlab.app`, 0.1.0, 470 MB, `codesign --verify --deep --strict` ok                                 |
| Packaged client vs build output                                  | **846/846** JS/CSS/HTML files byte-identical                                                                                                 |

One test is environment-sensitive rather than broken: `skips the primary native
probe for cross-architecture Windows payloads` asserts that no spawned command
carries `ELECTRON_RUN_AS_NODE=1`, but the probe commands inherit the ambient
environment. From a shell that already sets it - this session's harness does -
the test fails; with `env -u ELECTRON_RUN_AS_NODE` it passes.

Resolved since this snapshot: `v0.1.1` published the renamed
`codeitlab-<platform>-<arch>` archives (so the one-liner installers stopped 404ing),
and on 2026-10-27 both `v0.1.0` and `v0.1.1` were deleted in favour of a single
`v0.2.0` release — see the 2026-10-27 section. Still open from here:
`codeitlab@0.2.0` on npm needs your trusted publisher, and `packaging/aur` keeps
upstream names because those PKGBUILDs install upstream builds.

## What is deliberately not done, and why

- **Stripe Connect sandbox run** — needs real `sk_test_…` and `acct_…`; the
  adapter, idempotency and reconciliation are implemented and tested against a
  fake API, but the live sandbox run is the one thing that needs your keys.
- **Browser end-to-end run** — needs your explicit permission to drive a browser;
  everything it would click is covered by server-rendered tests.
- **Lighthouse PWA ≥ 90** — needs a browser; the PWA is installable, offline
  page, manifest and service worker are tested at the HTTP level.
- **Rust/WASM sandbox for untrusted agent or plugin code** — there is no
  untrusted execution path yet; adding the sandbox before the need would be
  cargo-culting. The decision is documented in `VISION.md` §4.3.
- **`npx codeitlab@0.1.0`** — that tarball pins its download to
  `/releases/download/v0.1.0/cil-0.1.0-*`, and the `v0.1.0` release was deleted on
  2026-10-27, so the pinned version now fails on a 404, and unpinned `npx
codeitlab` fails the same way because npm's `latest` still points at `0.1.0`.
  The fix is publishing `0.2.0` to npm (needs your trusted publisher);
  `scripts/install.sh`, which reads the newest release, is unaffected.
- **"Latent" = [Latet](https://github.com/Latet-AI/latet)** — the privacy
  firewall the README already cites. It is implemented natively (prompt guard,
  restore, gateway) rather than copied, and it is on by default; see
  [CREDENTIALS-PROXY.md](CREDENTIALS-PROXY.md).

## Next three moves

1. Run the Stripe sandbox with your test keys (one command).
2. Let me drive one browser pass over the marketplace (needs a yes).
3. Then a real deploy: follow [DEPLOY-MARKETPLACE.md](DEPLOY-MARKETPLACE.md) —
   systemd unit, Caddy `/market` mount, verified nightly backup, and the
   `doctor` + `smoke` gates before it is public.

## No constraint doc is orphaned

Five of the thirty-two docs under docs/codeitlab were linked from nowhere:
ARCHITECTURE, BUILD-PLAN, FREE-API-PROVIDERS, PWA and STATUS itself.
docs/codeitlab/README.md is now the grouped index for all of them, README links
it next to LIMITS, and the docs test fails if a doc is added without a line there.

## Every guide is one click from the README

Twenty-six user guides were not linked from README.md, which meant they were only
findable by listing the directory. `docs/user/README.md` is now the complete index
(grouped by task), README links it, and the docs test fails if a guide is added
without a line there or if README stops linking the index.

## Anchors are checked too

The same test now validates the `#fragment` of every relative Markdown link
against the target file's real headings, using GitHub's anchor rule (lowercase,
punctuation dropped, spaces to hyphens). The 19 candidates it first flagged were
all false positives from a checker that only read `##` headings; with all six
levels parsed, every anchor in `docs/` and README.md resolves.

## Links are checked too

`docsStructure.test.ts` now walks every Markdown file under `docs/` plus
README.md, strips fenced blocks and inline code (they show syntax, not links) and
fails on a relative link whose target does not exist. Five stale links were fixed:
`providerMaintenance.ts` to `providerMaintenanceRunner.ts` (two docs),
`continuationRequests.ts` to `ProviderContinuationRequests.ts`, `deviceStream.ts`
to `DeviceStreamView.tsx`, and the react-native-screens patch to the vendored
`apps/mobile/deps` tarball.

## The doc cannot silently duplicate itself

`docsStructure.test.ts` fails if STATUS.md, LIMITS.md or UI.md repeat a `##`
heading. A bad merge had left 29 duplicated sections in STATUS.md, with the newer
text hidden behind an older copy; the file is deduplicated (646 lines to 416) and
the guard keeps it that way.

## Naming

[RENAME.md](./RENAME.md) records which surface uses `CodeItLab`, `cil` or `codeitlab`,
and which hosted origins are still placeholders awaiting a domain decision.

## UI quality bar coverage

Every CodeItLab surface is held to [UI.md](./UI.md). The table records what is
enforced by a test, not what is intended.

| Surface                                   | Keyboard test                          | Explicit `type="button"` | Honest states                                 |
| ----------------------------------------- | -------------------------------------- | ------------------------ | --------------------------------------------- |
| Marketplace                               | yes (`marketplace page` browser tests) | yes                      | empty, invalid URL, configured                |
| Board                                     | yes (move, details, delete)            | yes                      | per-column empty state, no rows, read failure |
| Bots                                      | yes (keyboard start)                   | yes                      | empty, missing message, missing instructions  |
| Deploy                                    | yes (keyboard run)                     | yes                      | empty, no project                             |
| Sketch / Mood / Issues / Team / Wallpaper | —                                      | yes                      | existing browser tests                        |

Every CodeItLab surface now has at least one keyboard test. Browser tests for
`apps/web/src/components/codeitlab` currently total 103.

## External links are checked before release

`scripts/check-doc-links.mjs` walks README.md and docs/, collects every `http(s)`
link and asks curl for its status (one retry, small batches, so a rate-limit burst
is not mistaken for a dead link; 403 from chatgpt.com and x.ai is allowlisted
because those hosts block non-browser clients). All 57 links resolve today. The
one dead link found - the Electron accelerator page - now points at the menu-item
page's accelerator section. This is a manual pre-release check, not a test,
because it needs the network.

README told people to install the PWA at `app.codeitlab.com` and buy at
`codeitlab.com/market`. Checked today: the subdomain resolves but answers nothing
over HTTPS, and `/market` returns 404. README, PWA.md, REMOTE.md and MARKETPLACE.md
now say the hosted origins are intended, not deployed, LIMITS has a row for it,
and the docs test fails if the README drops the caveat or PWA.md mentions the
origin without one.

## The guide names every escrow transition

The user guide explained what each escrow state means but never said which action may start
from which state, so a reader could not tell why a button was refused. The guide now carries
the transition table, and a guard reads `ALLOWED_FROM` from the engagement service and the
table from the guide, failing when either drifts; a second check holds every "ends in" status
to the stored `EngagementStatus` union.

## The fee copy is held to the money path

The marketplace panel, the user guide and the money path each stated the take rate on their
own, so a change to `PLATFORM_FEE_BPS` or `ASSISTED_FEE_BPS` could leave the panel promising a
number the server no longer charges. A new guard reads the constants, the panel's quoted
percentages and the user guide, and fails when they disagree; it also holds the panel's
escrow-state table to the exact `EngagementStatus` union the deployment stores, in order. The
marketplace suite itself is green in this run.

## Ecosystem says what Install writes

The ecosystem page wrote MCP registrations and policy files behind a button that never said
so, showed a blank page when the server reported no integrations, and had no browser tests.
The button now points at a polite line that says what it writes, an empty catalog gets a
next step instead of whitespace, and three browser tests cover the install line, the empty
state and a not-detected integration.

## Remote names the live tunnel action

The remote page disabled two of its three tunnel buttons and its pairing button in
ordinary states, and a static hint was the only explanation; Refresh status could be
clicked while a read was already running, and the page had no browser tests. Every
tunnel button now points at one line that names what the current state allows, Refresh
status disables while reading, the pairing action points at a line that says whether a
link exists and that links expire, and five browser tests cover those states.

## The permissive profile says which switches wait

Three controls on the Uncensored page depended on the profile switch without saying so:
the audit trail had nothing to record under the standard profile, the per-provider
switches had no profile to apply, and a provider the server reports as unsupported could
still be toggled. Each now disables with a line that names the first step, the profile
switch and Refresh point at lines that say what they are doing, and the page gained its
first four browser tests.

## REA says what Install and Auto-activate do

The REA surface disabled Auto-activate only through its dependency on the Enabled switch
without saying so, and its Install button had no explanation and no tests. Auto-activate
now disables while REA itself is off and points at the line that names Enabled as the
first step; Install points at a polite line that says it rewrites both the MCP server and
the seeded skill, and turns into the install result when one arrives. Three browser tests
cover the install line and both auto-activate states.

## One probe per Retry click

The integration surface offered three Retry buttons that could all start a probe at once,
disabled its enable switch while saving without saying why, and had no browser tests.
Retries now disable while a probe is in flight, the switch points at a line that says it
is saving or what the surface is set to, and the status line always says what it is
based on. Four browser tests cover the switch line, the status line, one probe per click
and the saving state.

## Effects only offers what it can do

Reset ran even when every setting already matched the default, and the four Preview
buttons played nothing while sound was muted, because the audio layer returns early
without a master gain. Reset now disables at defaults and points at a line that says so;
Preview disables while muted and points at a line that names the master switch as the
way in. The page had no browser tests at all, so it gained four: the two Reset states,
the muted Preview block, and a Preview that reaches the audio layer once sound is on.

## A quest cannot be added to the board twice

Add as board task stayed enabled after the quest was already on the board, so a second
click wrote a duplicate task. It now disables against the board it will write to (the
database when it is live, settings otherwise), points at a line that says the quest is
already there, and says what the button does when it is not. The quest progressbar also
stopped reporting a zero maximum and gained aria-valuetext, and Refresh status points at
a polite line that always names what the counts are based on. Two browser tests cover
the duplicate block and the refresh line.

## The profile can hand its brief over

The profile page explained that the marketplace only sees the declaration if the user
pastes it into a job brief, then offered no way to copy it: the preview was display
only. A Copy brief action now sits in the heading, disables with a reason while both
fields are empty, and copies the exact lines an agent would receive (or says the
clipboard is unavailable and points at the preview). Two browser tests cover the
disabled state with its reason and the copied text.

## Nexus says what the catalog covers

The Nexus header offered Refresh with no indication of what the last build produced or
when, and filtering narrowed three lists without saying how much was hidden. The page
now carries a polite line under the heading that names the build time, provider count
and the three catalog sizes (and switches to "Refreshing the catalog…" while the button
is busy), plus a filter summary that counts hidden items per list. Two browser tests
cover the build line and the filter counts.

## A mood board button says what it needs

Four mood-board actions could be clicked and do nothing or fail afterwards: Add colour
with a non-hex value answered by a toast, Add reference and Add note with an empty field
returned silently, and Send to thread waited for a click before naming an empty board or
a missing project. Each button now disables against the same predicate its handler uses
and points at a per-board line that says what it needs — a hex value, a URL, a note, a
colour or the project a thread runs in. The page looks the first project up once instead
of inside the handler. Three browser tests cover the blocked colour, the reference and
note buttons, and the missing project.

## A blocked install names the block

Install went disabled with no explanation unless the environment was local, and the one
sentence that existed only covered the missing-environment case. The page now renders
the explanation whenever canInstall is false, with different copy for a local install
block and a provider-change block, and every disabled Install points at it with
aria-describedby. Two browser tests cover both blocks plus the untouched case where
installs are allowed.

## The wallpaper page only offers the action that does something

Apply wallpaper and Turn off were both live in every state, and the opacity control was
a hand-rolled range input while the routing panel already had a labelled slider
primitive. Apply now disables when the wallpaper is already on or when a custom preset
still lacks a URL, Turn off disables when it is off, both point at a polite line that
names the live action, and opacity uses CodeItLabSlider with its own value output. Two
browser tests cover the button states and the custom-URL block.

## The sketch canvas is reachable and honest

The canvas was pointer-only and outside the tab order, and its stroke counter was
silent, so a keyboard or screen-reader user could not reach the drawing area or hear a
stroke land. The canvas now takes focus, is described by the polite stroke counter, and
its label says plainly that drawing needs a pointer while Undo and Clear work from the
keyboard. Both actions point at the same counter for their disabled reason. A browser
test focuses the canvas, checks the description and watches the count change after a
drag.

## A context typo no longer erases the size

The context table had the budget table's bug: it saved on blur and read "1M" as an
empty field, so a typo erased the recorded size and fell back to an estimate without a
word. It now refuses anything that is not a digit count, says what was not saved, and
announces a recorded or removed size with what takes over afterwards. Two browser tests
cover the refusal and the announcement, next to the existing record and clear tests.

## A budget typo no longer deletes the budget

The budget table saved on blur and read every non-numeric value as "clear this
budget", so a typo silently removed the number the user was trying to set, and nothing
confirmed a save at all. record() now refuses a value that is not a token count, says
so in the polite line ("Not saved: “50k” is not a token count."), and announces real
saves and removals with what the budget does. Two browser tests cover the refusal
leaving the stored budget alone and the save announcement.

## Issues says which action is blocked

Add issue and Send to thread both used to accept a click that could only fail: an empty
title was answered by a toast and a missing project by another one. Add issue now
disables against issueTitleProblem and points at the line that names the problem, while
Send to thread disables when no project exists and points at the page-level note that
explains why a thread needs one. The send path reads the same first project the button
does. Two browser tests cover both blocked states and the title unlocking as you type.

## The vault panel says what saving changes

The credentials panel offered Save settings with nothing changed, let Start and Stop sit
enabled when the gateway state made one of them pointless, and rendered its scan box as
a raw textarea with hand-written typography. Save now disables itself until the draft
differs from the saved settings and points at a polite line that says which state it is
in; Start and Stop disable against the real gateway state and share the line that names
the reason; copying a gateway URL is announced. The scan box uses the shared Textarea,
which gained a mono variant instead of per-page typography. Two browser tests cover the
save and gateway states.

## Reordering providers keeps the keyboard

The provider-order arrows disable themselves at the ends of the list, so moving a
provider to the top or bottom dropped focus to the body with no word about what moved.
moveProvider now announces "Moved claudeAgent up to position 1." in a status line and
moves focus to the opposite arrow on the same row when the pressed one just became
disabled. The routing suite drives the arrow with Enter and checks both the new order,
the announcement and the focus target.

## Memory says whether it is empty or filtered

The memory page used one empty block for two different situations, so a first-time
reader saw "No memories match" as if a filter had failed. It now separates "No memories
yet" (with what happens to a turn without them) from a filter miss that names the
query, explains that the filter reads text and tags only, offers Clear filter, and says
how many memories exist. A filtered list also counts what it shows. Three browser tests
cover the empty case, the filter miss with its clear action, and the count.

## Start chat names every reason it is disabled

A bot's Start chat only disabled itself for a broken bot, so a disabled bot, an empty
message or an empty project list still let the click through and answered with a toast.
It now computes the same four reasons the start path checks, disables itself, and writes
the first one into the polite line it already points at with aria-describedby. The
project lookup moved out of startChat so the button and the run read the same project.
The bots suite now walks the message and project reasons in order and proves the
keyboard path reaches the handler once both are satisfied.

## Run deploy says what is missing first

The deploy menu only disabled Run deploy for a broken target, so a disabled target or
an empty project list still let the click through and answered with a toast. The button
now carries the same three reasons the run path checks (target issue, target disabled,
no project), disables itself, and points at the polite line that names the first one.
The project lookup moved out of runDeploy so both the button and the run read the same
first project. Two deploy tests were rewritten for the new behaviour and the keyboard
one now proves the click reaches the handler.

## A team run links back to its thread

A recorded team run named its thread id in plain text and offered no way to open it, so
the transcript was one manual route lookup away. The run card now has an Open thread
button that goes to the same /$environmentId/$threadId route the board uses, and when
the shell list no longer contains the thread it says "no longer exists" instead of
linking somewhere that bounces back to the home screen. Two card tests cover both
states.

## Start team says what is missing first

The team composer let you press Start team with an empty brief or a broken preset and
then explained the problem in a toast. The button now reads the same teamPresetIssue
the start path uses, plus the empty brief, disables itself, and points at a polite line
that names the first thing to fix. The browser test opens a preset with no task, checks
the disabled button and its reason, then types and watches both flip back.

## The notes sheet says whether the draft is saved

The details sheet had one button and no state: Save notes was always enabled, it closed
the sheet on every press, and Escape discarded a draft without a word. The button is
now disabled until the draft differs from the saved notes, it names the line that
explains why ("Unsaved changes; closing the sheet discards them."), saving keeps the
sheet open and announces "Notes saved." in the same polite live region. The browser
test types, checks the unsaved copy, saves, and confirms the sheet is still there.

## A moved card keeps the keyboard

Moving a board card with its arrow unmounted the button that did it, so the keyboard
user was dropped at the top of the document with no idea which column the card went
to. Both arrows now go through moveTask, which returns focus to the moved card's
Details control and writes the move into a role="status" line ("Moved “Fix login” to
In progress."). The board browser test drives the arrow with Enter and checks both the
focus target and the announcement, and boardKeyboard.test.ts fails if a future arrow
goes straight to persistTasks.

## A disabled action carries its reason

Three actions disabled for a reason the label does not show were silent to assistive
technology: the shorts submit (needs the rights confirmation), the phone-link button
(pairing is disabled on this server) and a bot's Start chat (the bot has no name or no
instructions). Each now names the element that holds the reason with
aria-describedby; the phone-link case also renders the explanation next to the button
instead of only in a paragraph that disappears once a link exists. disabledReasons.test.ts
walks those three markers and fails if the wiring or the referenced element goes
away, and the bots suite checks the attribute on the disabled button.

## The marketplace opens with somewhere to go

The marketplace panel was honest but passive: with no address saved it rendered four
explanation cards and a disabled Open button, so the first thing a reader saw was a
wall of prose and an action they could not use. It now opens with "Nothing to open
yet", says the marketplace is a separate deployment, and offers a Paste the
marketplace address button that moves focus to the field. The disabled Open button
also points at the help text with aria-describedby, so its reason travels with it.
Three browser tests cover the empty state, the description link and its removal once
an address is saved; the whole marketplace suite runs in the verification snapshot.

## The telemetry account matches the code

LIMITS.md said "CodeItLab sends no telemetry by default", which contradicted both the
code (product events default to on and go to `ingest.codeitlab.dev`) and
docs/user/telemetry.md. Since telemetry defaults are out of scope, the fix is the
honest page, not a silent default change: LIMITS now says CodeItLab operates no
endpoint of its own, inherits the upstream product events and Axiom relay traces,
lists what those events never contain, names `CIL_TELEMETRY_ENABLED=false`, and links
the user guide. docsStructure.test.ts now fails if either page drops the endpoint or
the switch, or if LIMITS claims silence again.

## The four surfaces share one contract

All four surfaces had been walked one at a time, which is how the same gap reappears
on the next one. The audit found one leftover: the quick overlay's prompt field was
`outline-none` with no replacement, so the main control of the desktop shell showed no
focus indicator when the Tab trap wrapped back to it. It now uses the same inset
outline as the rest of the product, and its browser test reads the computed outline
after a keyboard wrap.

surfaceContracts.test.ts writes the shared contract down: a surface with nothing to
show names a next step, empty and async states announce themselves with role="status",
each surface's main control shows focus (with the palette shell's deliberate
`has-focus-visible:ring-0` exception asserted rather than assumed), and the shell
dialog keeps Escape, a Tab trap and aria-modal.

## The palette miss leads somewhere

The command palette is the third surface, and its miss was the same shape the settings
search had: "No matching commands, projects, or threads." with no scope and no way
out, and no live region, so a screen reader never heard it. The miss now names the
scope ("search matches names and common synonyms"), says to try a shorter word or
press Esc, announces itself with role="status", and keeps the actions-only variant
short. A browser test covers both variants.

## Settings search says what it can reach

The settings panel is the second of the four surfaces, and its search box is the only
way through thirty-odd sections. A miss showed "No settings found" and stopped there,
which reads like the setting does not exist rather than like the search cannot reach
it. The miss now names the query, says search covers names, section labels and
synonyms but not description text, and offers a Clear search button that returns to
browsing. The empty state has its own browser test, and settingsSurface.test.ts keeps
the nav on the shared component.

## The chat error banner says what survived

The chat surface is the one place a turn fails most often, and its banner said only
what broke: a raw provider message and a dismiss button, leaving the reader to guess
whether the conversation or their files were lost. It now ends with the honest
fallback — the conversation is saved, keep editing or retry the turn — for both a
failed turn and a usage limit. The banner browser test asserts the sentence, and
errorStates.test.ts covers the chat banner as well as the CodeItLab surfaces.

## The quick overlay behaves like a modal

The quick overlay claimed `aria-modal` but only trapped nothing: Tab walked out into
the page behind it, Escape only worked while the textarea had focus, and closing left
the keyboard user at the top of the document. It now traps Tab and Shift+Tab across
its own controls, closes on Escape from any of them, and hands focus back to whatever
had it before the chord. The overlay browser test drives the whole cycle, and
overlayKeyboard.test.ts now also scans desktop shell dialogs for an Escape handler, a
Tab trap and a test that presses both.

## Choice groups are one tab stop

UI.md asks a group of choices to be one tab stop with arrow keys. Only the section
navigation did that; the agent tier tabs, the agent kind filters, the sketch colour
and width rows and the wallpaper presets were plain rows of buttons, so reaching the
last preset took five Tabs and the arrows did nothing. CodeItLabToggleGroup now
renders those rows with a roving tabIndex and Arrow/Home/End handling, all five rows
use it, and toggleGroups.test.ts fails when a new filter row is written as a mapped
`aria-pressed` button instead. Browser tests drive the arrows on the tier, width and
preset groups.

## Focus rings cover the raw controls too

Controls from components/ui inherit a focus ring; raw elements do not, and the audit
found four: the bots, deploy and wallpaper checkboxes were native `<input>`s, the
issue status was a bare `<select>`, and a team preset was a bare `<button>`, so
keyboard users could not see where they were. The three checkboxes now use the
shared Checkbox component (which also gives them an accessible name), the select and
the preset button carry the inset focus outline, and focusRings.test.ts fails on a
native checkbox, a raw select or button without a focus-visible ring, or an outset
outline offset.

## The motion budget is measured, not assumed

motionBudget.test.ts already checked the reduced-motion branches, the 120–200 ms
entrance and the absence of component-level `animate-*`. It now also measures the
entrance keyframe itself (the translate must stay at or under 4 px), checks that
the ambient scene renders one static frame and never starts its loop under reduced
motion, and checks that the loading skeleton goes through the motion-safe primitive.
The audit found no component-level animation in the CodeItLab surfaces at all; the
only continuous motion is the shared skeleton, so UI.md now names that as the one
allowed exception instead of implying the panel is silent while loading.

## Accent text passes AA on its own tint

UI.md says accent text never sits on an accent background at small sizes, and the
status chips do exactly that: `text-codeitlab-green` on `bg-codeitlab-green/8…12`.
Measuring the pairs found the light theme failing AA — 4.37 at 8%, 4.13 at 12% —
because the light accents were picked for phosphor looks, not for text on tint. The
light tokens are now #066a43 and #0b5f76 (5.04 and 5.44 at 12%), the dark theme was
already well clear, and contrast.test.ts reads the tokens out of index.css and fails
when any accent-on-own-tint pair drops below 4.5.

## Navigation sticks, never fixes

UI.md asks for sticky navigation so a bar cannot cover the chrome. The audit found
one `fixed` element in the CodeItLab surfaces, the wallpaper background layer, which
is allowed because it is pointer-events-none and sits behind everything; the
section navigation was already sticky. The section nav test now asserts the computed
position, and navigationPosition.test.ts fails if a CodeItLab bar starts using
`fixed` without being a background layer.

## Counts do not jitter

UI.md asks metrics, timers and counts to use tabular-nums. An audit found the
primitive stat hint, the badge base, the button base and a dozen inline count
lines rendering proportional digits, so every panel number moved sideways as it
changed. Those now use tabular-nums, including the agent tier tabs and the worker
counts. The overview suite asserts the computed font-variant-numeric on both a
stat hint and a badge, which is the observable behaviour rather than a class name.

## Sound is off until asked for

UI.md calls SFX opt-in and says silence is the default state, but the settings
default had `sfxEnabled: true` with every event enabled: the first click on any
surface made noise the user never asked for. The default is now off, the Effects
row says so, and the appearance guide explains how to turn it on. audio.test.ts
pins both halves: no AudioContext is created while sound is off, and enabling it
plays once. The per-event switches and the ambient hum keep their own defaults.

## Skeletons announce what they load

Four pages render CodeItLabLoadingRows. The rows matched the card shape but the
block was invisible to assistive tech: no role, no name, so a screen reader heard
a page that had simply finished empty. The primitive now renders a status region
with aria-busy and a screen-reader label, each page names what it is loading
("Loading agents", "Loading credentials", …), the agents suite asserts the
announcement while pending, and loadingStates.test.ts fails when a new skeleton
omits its label.

## Errors say what still works

The UI bar asks an error to name the fallback, and four surfaces could show one.
The board and the remote page already did. The ACP registry banner, the provider
integration alert, and the Shorts job card showed a bare message with Retry, which
leaves the reader unsure whether their data survived. Each now says what keeps
working (installed agents, saved configuration, the running render), and
errorStates.test.ts fails when a file that renders an error stops naming a fallback.

## Empty states lead somewhere

An audit of all ten CodeItLabEmptyBlock instances found the descriptions already
explain the next step, but three Nexus blocks told the reader to "clear the filter"
with no control to do it, and the issues page told them to write an issue while
their focus sat nowhere near the field. Nexus now has one Clear filter control next
to the search input (instead of three duplicate buttons), each Nexus block says
what would fill it when no filter is set, and the issues empty state has a
"Write the first issue" button that moves focus to the title field. Browser tests
cover both paths.

## Every overlay is Escape-tested

An audit of the CodeItLab surfaces found exactly one overlay primitive: the board
details sheet. Marketplace, bots and deploy have no sheet or dialog, so the UI
bar's "Escape closes" rule has one place to hold today. Its test now also asserts
that focus returns to the Details button that opened the sheet, and a new test
scans the surfaces for Sheet/Dialog content and fails when one has no browser test
that presses Escape.

## Board keyboard coverage is complete

The board browser suite already moved, archived, unarchived, deleted, started and
opened details with Enter; two gaps were left. The "Open thread" control had only
a click test, and a half-typed task in the New task field had no way out except
Tab. Enter in that field saves, Escape now clears the draft and keeps focus, and
both are covered by browser tests (34 in that file).

## The palette reaches every product surface

The command palette had one CodeItLab entry (the panel) and Studio, so board,
marketplace, bots, deploy and crew were reachable only by remembering which
settings tab owned them. It now has five named commands for those surfaces, and
panel.test.ts fails when a palette destination has no route file or when one of
those five disappears.

While adding them, the palette focus test turned out to fail on macOS: it pressed
Ctrl+P, but `mod+p` resolves to Cmd there, so the test only ever passed on Linux.
It now presses the platform's modifier and all three cases pass.

## Section icons live in one map

SettingsSidebarNav repeated an icon for all 25 CodeItLab subpages even though it
filters those out of its own nav, so a new section needed an entry in two maps and
could differ between them. The duplicate entries are gone: the sidebar keeps only
the panel entry, its icon map is typed to exclude `/settings/codeitlab/*`, search
results that point at a subpage fall back to the panel mark, and a test fails if a
subpage key reappears.

## Every panel section has a route file

The registry test checked labels, icons and search entries but not routes, so a
section could be listed and still open a blank page. It now compares the registry
with apps/web/src/routes: every `to` has its `settings.codeitlab.*.tsx` file, and
every such file is registered (the layout and the index page are structure, not
sections). 26 sections, 26 routes, no orphans.

## User guides point at real files too

The same check now covers docs/user: every inline `apps/`, `packages/` or `scripts/`
path must exist. All 51 guides pass. Environment names need no separate check: there is
no alias layer, so a guide either names a variable the source reads or it is wrong.

## Constraint docs point at files that exist

Twenty inline paths in the constraint docs pointed at files that were never there
or had been renamed: the nexus server module before it moved under codeitlab, the
memory contract that lives in the codeitlab package rather than contracts, an
audio engine that was never called SfxEngine, a control route that was never
created, a REA activation policy file that was never written, and more. They now
name the real modules, and the docs test fails when an `apps/`, `packages/` or
`scripts/` path in a constraint doc does not exist. FEATURE-SPEC.md and
BUILD-PLAN.md are excluded because they are design documents, and both now open
with a banner saying so.

## Marketplace doc is checked against the contracts

The constraint doc quoted the fees and listed the escrow states by hand. The fee
test now reads docs/codeitlab/MARKETPLACE.md as well: both server percentages must
appear, and every `EngagementStatus` the server stores must be named there. A new
state in contracts.ts without a line in the doc fails the suite.

## README quotes both fees

The README said the marketplace pays out "minus a 15% platform fee", which is only
the self-serve tier; the server also has a 20% assisted tier. It now names both,
and the fee-copy test reads the README too, so the first number a business sees
cannot drift from the contracts.

## Marketplace copy is checked against the server

`apps/web/src/components/codeitlab/marketplaceFees.test.ts` reads the marketplace
contracts from disk and fails if the panel's fee percentages drift, if a stored
escrow state is missing from the legend, or if the panel invents a state the
server never stores. `marketplace.md` lists the same eight states.

## Motion budget is guarded in components too

`motionBudget.test.ts` now also reads every `.tsx` under
`apps/web/src/components/codeitlab` and fails on `animate-*`,
`transition-[width]` or any `duration-3xx`. The quest progress bar was the one
offender: it animated its width for 300 ms, outside the 120-200 ms entrance
budget and a repaint on every refresh. The bar now changes instantly.

## Motion budget is guarded

`apps/web/src/codeitlab/motionBudget.test.ts` reads the stylesheet: the panel
entrance must stay inside 120-200 ms, and the reduced-motion branches for the
entrance and the sheet primitive must exist. The sheet's Tailwind transition
gained that branch this round.

## Rename drift is checked

`renameDrift.test.ts` walks the checkout and fails when the retired upstream brand
appears in any tracked path or text file, so it catches a surface a hand-picked directory
list would miss. It skips build output, `.repos/`, dependency trees and binary formats;
RENAME.md lists the tokens each surface is allowed to use.

## Fee copy is checked against the server

`apps/web/src/components/codeitlab/marketplaceFees.test.ts` reads
`PLATFORM_FEE_BPS` and `ASSISTED_FEE_BPS` from the marketplace contracts and
fails if the panel's prose stops matching, and asserts both stay inside the
promised 15-20% band. No runtime dependency: the test reads the source.

## A quest can become a board task

The next quest on the overview page has an **Add as board task** action: it
creates an ordinary Pending task with the quest title, the lesson as notes and
the route where the work happens. Nothing starts automatically. Covered by
`apps/web/src/codeitlab/board.test.ts` (helper) and
`CodeItLabOverviewPage.browser.test.tsx` (click writes settings and mirrors to the
database). See [quests.md](../user/quests.md).

## Every field has a name

A scan of the codeitlab pages found one unlabelled design-system field: the
gateway port in credentials had only a sibling `span`, so it was a silent text box.
It now has a real `<label htmlFor="gateway-port">`, and `formLabels.test.ts` fails
on any `<Input>`/`<Textarea>` in the pages without an `id` or `aria-label`. The
scan is a heuristic (an id still needs a label), but it catches the exact shape
that slipped through.

## Deploy target issue is announced

Same hole as bots: the deploy target's issue line ("Add the command this target
should run") was visual only, and Run deploy is disabled by it. The command field
now points at the live issue paragraph, the attribute is omitted when the target
is valid (no dangling id), and the page has its `data-codeitlab-page` marker.
Browser tests cover blocked and valid targets.

## Bot issue is announced

The bots page showed "Give the bot a name..." under the message box but the field
did not point at it, so the reason for the disabled Start button was visual only.
The help line is now one `aria-live` paragraph with a stable id, the message field
carries `aria-describedby`, and the page has its `data-codeitlab-page` marker.
Browser tests cover the blocked and ready states.

## Marketplace URL is announced

The marketplace URL field had a visible error but no programmatic link to it, so a
screen reader read an empty text box. The input now carries `aria-invalid` and
`aria-describedby`, the help paragraph is one `aria-live="polite"` element with a
stable id, and the page has its `data-codeitlab-page` marker. Browser tests cover
the invalid and valid states.

## Board page structure is navigable

The page has one `h2` ("Board"), an `h3` per column and one for Archived, each
column is a labelled `section`, and the status line is `aria-live="polite"` so a
database fallback is announced. Browser test asserts the headings, the sections
and the live region.

## Board keyboard coverage

Every card control is a real button with a label, and the browser suite now pins
the keyboard path for each: move (arrow), details (Enter opens the sheet), notes
save, archive, unarchive, delete (active and archived), Start (with a project), and the explanation toast
when Start has no project, Escape to close. The
sheet's own focus trap is the primitive's, not the board's.

## Quest card keyboard reach

The "Add as board task" button activates with Enter, the quest links and the
"All quests" summary carry an inset focus ring, and a browser test focuses the
button and presses Enter to assert the board write happens from the keyboard.

## The quest card re-reads its facts

Adding a quest as a board task now refreshes the quest board after the database
write, and the quest query uses `staleTimeMs: 0` instead of ten seconds: the card
is derived from every other service, so a cached answer can be wrong the moment
the user acts. Browser test: the click refreshes quests after the upsert.

## The board is a quest fact

Two quests now come from the board: "Write down the next step" (one active task)
and "Finish one task" (one completed task). `questFactsFrom` reads the board
service's list, so the education layer and the doing layer share one truth. The
architect level moves to 10 of 11, and the level thresholds are unchanged
otherwise. Tests: core quest units (11 total, order, levels) and the server probe
degradation test.

## Every task field has a home

`CodeItLabTask` carries ten fields; each one is either shown somewhere the user
can see or documented as internal, and each has a test that changes it:

| Field         | Where it shows                               | Test                                |
| ------------- | -------------------------------------------- | ----------------------------------- |
| `id`          | internal: row key and RPC handle             | repository roundtrip, task creation |
| `title`       | card, prompt, quest bridge                   | create/notes tests                  |
| `notes`       | card, details sheet, prompt                  | `updateBoardTaskNotes` test         |
| `column`      | card position, chips, progress               | move tests, chips tests             |
| `threadId`    | card link, "no longer exists" sentence       | start/open/orphan tests             |
| `createdAt`   | details sheet ("Created …")                  | creation test, sheet test           |
| `updatedAt`   | card date, ordering                          | move test                           |
| `archivedAt`  | Archived section date                        | archive/unarchive tests             |
| `completedAt` | details sheet, streak day                    | completion tests                    |
| `startedAt`   | In progress card, details sheet, auto-review | start/auto-review tests             |

## startedAt keeps auto-review honest after edits

Auto-review compared the run completion with `updatedAt`, so editing notes on a
task whose run had already finished blocked the move to Review for good. Tasks now
record `startedAt` on entering In progress (cleared when they leave), the details
sheet shows it, the In progress card shows "Started <date>", and auto-review
compares against it with `updatedAt` as the fallback for old rows. Migration 070 adds the column; contracts accept the field
as optional so older clients still decode. Tests: helper unit cases (start sets,
leaving clears, notes edit still reviews), a page-level browser test, and a
repository roundtrip.

## An orphaned thread id is labelled, not linked

A board task keeps its thread id after the thread is deleted. The card now says
the thread no longer exists and offers Start again instead of a link that lands
on a missing thread. Browser test: a task with an unknown thread id shows the
sentence and no "Open thread" button.

## Start and restore go through the same write path

`startBoardTask` (thread id) and `unarchiveBoardTask` (clear the archive date)
already used `persistTasks`, so round 172's baseline fix covers them; browser
tests now pin both against a database-only board: Start records `thread-9`, and
Unarchive upserts `archivedAt: ""`.

## Auto-archive writes through to the database

The 7-day auto-archive updated settings only, so a shared board re-read the task
as active on the next load and archived it again every time. The effect now
upserts the archived rows too. Browser test: a stale database task gets an
`archivedAt` upsert and the toast appears.

## Board writes diff against the copy on screen

`persistTasks` compared the next board with the settings fallback. When the
database was the source and settings was empty - a board created on another
device - deleting a task never reached the database, so the row came back on the
next read. The diff now uses the displayed tasks. Browser test: delete a
database-only task and assert `remove` with no stray `upsert`.

## A settings-only board is copied on the first database write

The board page prefers the database once it has rows, so a user whose board only
lived in settings would have lost sight of those tasks after adding one task.
`persistTasks` and the overview's quest button now send the whole settings board
when the database answered empty, migrating it in the same action. Browser tests
cover both call sites. See [kanban-board.md](../user/kanban-board.md).

## Sidebar counts is a labelled group

The chip row was a `div` with an `aria-label` and no role, which assistive tech is
free to ignore. It is now `role="group"` with the "Board counts" label, and each
link carries its column and count ("Completed: 0 tasks"). Browser test asserts the
group role and all four labels, including the zero case.

## Sidebar counts read the same copy as the board

`SidebarBoardChips` used to read only the settings fallback, so a board stored in
the database looked empty in the sidebar. It now prefers the database when it
answered and falls back to settings, matching the board page. Browser tests cover
both paths. See [kanban-board.md](../user/kanban-board.md).

## Completion time is visible, not just stored

The board details sheet shows `Completed <date> UTC` for a finished task and
"Not completed yet" otherwise, so the date the streak counts can be checked.
Covered by `apps/web/src/codeitlab/board.test.ts` (formatting) and the board
browser suite (the sheet text).

## Completion time is its own field

`completedAt` is written when a task enters Completed and cleared when it leaves,
so editing notes on a finished task neither moves its streak day nor restarts the
seven-day archive clock. Migration 069 adds the column; old rows fall back to
`updatedAt`. Covered by `packages/codeitlab/src/progress.test.ts`,
`apps/web/src/codeitlab/board.test.ts` and `apps/server/src/persistence/CodeItLabTasks.test.ts`.

## Board progress (gamification that is not a game)

Completed count and a UTC-day streak, computed from the board's own tasks:
`packages/codeitlab/src/progress.ts`, four unit tests, and a browser test for the
card. Deliberately no points or badges, and the card says what it counts.

## Profile (interest domain + skillset)

The declaration the vision asks for exists as its own panel section:
`CodeItLabProfileSettings` (local, user-written) with `profileBrief` producing a
labelled block for agent context. The page previews the exact lines, and an empty
profile produces no block at all, and starting a bot chat appends that block to the
bot brief. Verified by `packages/codeitlab/src/profile.test.ts`,
`packages/codeitlab/src/bots.test.ts` and `CodeItLabProfilePage.browser.test.tsx`. See [profile.md](../user/profile.md).

## Honest limits

Every bounded behaviour and every blocked item is collected in [LIMITS.md](./LIMITS.md),
with the reason it is not done and what the app does instead.

## Verification snapshot (2026-10-25)

Superseded by the 2026-10-26 snapshot below for the counts it re-measured; kept because it covers
batches this round did not re-run.

Run on this machine, on the commit that carries this line, with
`vp test run` (never repo-wide):

| Batch                                                                             | Files        | Result                                                      |
| --------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------- |
| `packages/codeitlab/src` + `apps/server/src/codeitlab` units                      | 57           | 522 passed, 1 skipped, 1 failed (external, see below)       |
| Provider text generation (`provider-core`, `-muse`, `-acp-registry`, `-opencode`) | 59           | 675 passed, 2 skipped, 1 failed (environment, passes alone) |
| CodeItLab browser suite (`components/codeitlab`, incl. delivery handoff)          | 34           | 265 passed                                                  |
| CodeItLab web units (`apps/web/src/codeitlab`: routing fold, XP, board helpers)   | 40           | 238 passed                                                  |
| Chat browser suite (`components/chat`, incl. the delivery button)                 | 48           | 448 passed                                                  |
| `apps/marketplace` suite + `node scripts/check-doc-links.mjs` + docs structure    | 71 / 57 / 10 | 319 passed / 0 problems / 10 passed                         |
| `apps/web` typecheck / `apps/server` typecheck                                    | —            | 0 errors / 151 pre-existing errors (unchanged baseline)     |
| `vp fmt --check` + `vp lint` on the files this round touched                      | 33 files     | clean / 0 errors                                            |

The fmt and lint lines cover exactly the files this round wrote; a `vp fmt --check` over whole
directories still reports files other sessions are mid-edit on, which this round did not touch.
The provider and marketplace rows are carried from the previous snapshot unchanged: rounds 14–18
touched neither tree, and re-running them here would only repeat the same numbers.

Two failures are **not in this tree**:

- `apps/server/src/codeitlab/board/TasksService.test.ts` fails with
  `NOT NULL constraint failed: codeitlab_tasks.completed_at` against board persistence files
  another change in this workspace staged but has not committed. **Fixed on 2026-10-26** — the
  file is 37/37 green on `6c80cefc`; see the snapshot below.
- `packages/provider-opencode/src/server/OpenCodeRuntime.environment.test.ts` fails only when
  the whole provider batch runs together (process-ownership timing); the same file passes 22/22
  on its own. Neither file was touched this round.

The npm launcher build and the desktop typecheck run separately and are reported in their own
sections; nothing here claims a green repo-wide run.

## Verification snapshot (2026-10-26, recovery)

Measured on this machine on the recovery commit `6c80cefc` — «finish the interrupted session's
wiring and stop the board crash» — plus the round that follows it, with `vp test run` (never
repo-wide):

| Batch                                                                  | Files    | Result                                                         |
| ---------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| Board + task persistence units (the two previously red `TasksService`) | 1        | 37 passed                                                      |
| CodeItLab browser suite (`apps/web/src/components/codeitlab`)          | 34       | 266 passed                                                     |
| `apps/server/src/codeitlab` engagements, tasks and auth wiring units   | 14       | 386 passed                                                     |
| CLI + project-file units (`apps/server/src/cli`, `packages/contracts`) | 2        | 10 passed                                                      |
| `apps/web` typecheck / `apps/server` typecheck                         | —        | 0 errors / 118 pre-existing errors, all at upstream `fe27e8e3` |
| `vp lint` on the files this round touched                              | 5        | 0 warnings, 0 errors                                           |
| `node scripts/check-doc-links.mjs`                                     | 57 links | 0 problems                                                     |

The 118 is not comparable with the 151 of the previous snapshot: that baseline covered a wider
file set. Every residual error blames to the upstream boundary commit `^fe27e8e3` and none is in
a file this round touched.

The board crash itself is gone: nothing dereferences a missing settings object any more, because
all five board readers go through `settingsBoardTasks()` (`apps/web/src/codeitlab/board.ts`).

Delivered in the same round, each with its own proof:

- Desktop build and packaging both exit 0 (`pnpm run build:desktop`, then
  `node apps/desktop/scripts/package-codeitlab-app.mjs --output /Applications/CodeItLab.app`),
  and `codesign --verify --deep --strict` passes on the result. The packaged client is the
  verified one: all 841 `.js` bundles and `index.html` are byte-identical (`cmp -s`) to
  `apps/web/dist`. Only the `.js.map` files differ, and only in the absolute build paths baked
  into them.
- `npx codeitlab@0.1.0` is live on npm (`dist-tags.latest = 0.1.0`, `bin/codeitlab.mjs`,
  repository `rumbis/codeitlab`) and prints the CodeItLab CLI.
- The CLI `browser` subcommand no longer says «CodeItLab's browser»; the project-file annotation says
  CodeItLab with `cil.json` first and `cil.json` still read as the legacy fallback; and the
  desktop download link no longer points at the upstream product — it points at this
  repository's releases page.

Not claimed here: a signed desktop artifact on the releases page (only CLI archives and
`SHA256SUMS` are published), a green repo-wide run, or any hosted deployment.

## 2026-10-27 — publish round (GitHub snapshot, npm, independent verification)

An independent agent re-verified the marketplace `applyToJob` port and the rebuilt app from the
outside (evidence `/tmp/v37-item*.log`):

| Check                                                                                                                                                                      | Result                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| RPC wiring: 263 group requests ↔ 263 mirror entries, 65 `codeitlab*` methods → scope `"codeitlab"`, `CLIENT_GUARDED_RPC_SCOPES` 33 entries / 0 codeitlab                   | `RpcAuthorization.test.ts` 30/30 passed                          |
| `applyToJob` guards: baseline 39/39; guard mutation (`if (jobId === "")`) turned the blank-id test red at `EngagementsService.test.ts:644`, then reverted and re-run green | pass                                                             |
| Server typecheck `pnpm --filter codeitlab exec tsc-rs --noEmit`                                                                                                            | 118 errors, none in any file this work touched, all pre-existing |
| `vp lint` over the ten touched files                                                                                                                                       | 4 warnings, 0 errors, all four verbatim in the parent commit     |
| Installed `/Applications/CodeItLab.app` vs current build: SHA-256 of every `*.js/*.css/*.html`, both directions                                                            | 846 same, 0 diff, 0 missing, 0 packaged-only                     |
| Published tree                                                                                                                                                             | `refs/heads/main` tree == local HEAD tree `d9f82307`             |

Two corrections for the record: the server package filter is `codeitlab`, not `@codeitlab/server`
(that command is a silent no-op), and the acceptance text's "0 warnings" lint gate is stricter
than the pre-existing baseline, which already carries those four warnings in `RpcAuthorization.ts`,
`rpc.ts` and `rpcHandlers.ts`.

Publishing state:

- Release assets: closed. `.github/workflows/release-cli-archives.yml` now runs green on the
  `cli-v*` tag (`cli-v*` is the deliberate build signal; the `v*.*.*` `release.yml` is gated to
  the upstream repo), and release `v0.1.0` carries `codeitlab-0.1.0-{darwin-arm64,linux-arm64,
linux-x64,win32-x64}` plus a four-line `SHA256SUMS`. `scripts/install.sh` resolves those names
  and completed an end-to-end install into a temporary HOME: `Installed CodeItLab 0.1.0`,
  `codeitlab` and `cil` symlinks, and the installed binary is the new archive's `codeitlab`. The first
  green run failed on all four legs with `ServerCliExecutableImportError: ... imports file-backed
packages that a single-executable cannot resolve: playwright-core`; `renderStudioVideo` was the
  last `await import()` of a file-backed package and now goes through
  `createRequire(import.meta.url)` like the other adapters (`c49d71f8`).
- npm: `codeitlab@0.1.0` is live (2026-10-23, 7 files, `shasum 70b116f7...`) and
  `npx codeitlab@0.1.0 --version` prints `codeitlab v0.1.0`. That tarball predates the archive
  rename, so its launcher asks for `cil-0.1.0-<key>` and installs the legacy binary, while the
  repo launcher and `scripts/install.sh` ask for `codeitlab-0.1.0-<key>`; an aligned npm version
  is a version bump plus a matching archive build, not a code fix. `0.1.1` was that version (see
  the next bullet); it and `v0.1.0` were deleted on 2026-10-27 in favour of a single `v0.2.0`
  line — the 0.2.0 bullet below is the current state.
- CLI 0.1.1 (historical — the release and its tags are deleted): the four releasable manifests were bumped with
  `scripts/update-release-package-versions.ts 0.1.1` (`apps/server`, `apps/desktop`, `apps/web`,
  `packages/contracts`) and `release-cli-archives.yml`'s dispatch defaults moved with them
  (`84b06966`). Tag `cli-v0.1.1` on that snapshot produced green run 40420353413 (5/5 jobs:
  darwin-arm64, linux-x64, linux-arm64, win-x64, attach) and release `v0.1.1` now carries exactly
  `codeitlab-0.1.1-{darwin-arm64,linux-arm64,linux-x64,win32-x64}` plus a 4-line / 398 B
  `SHA256SUMS` — no `cil-*` asset, so the old stray-archive trap stays closed. The sibling
  `Publish CLI to npm` run 40420353519 got as far as building the `codeitlab@0.1.1` tarball
  (`7 files`, `shasum 5b64cde1e5e975dfc2d6b28cf426cdd0cbfce53a`, provenance enabled, resolved
  version from the tag) and then stopped at `npm error code ENEEDAUTH` / `need auth`. So the code
  path is done; the single remaining step is human: register the **trusted publisher** on
  npmjs.com for `rumbis/codeitlab` + `.github/workflows/publish-cli.yml` and re-run that workflow
  (Actions → `Publish CLI to npm` → run 40420353519 → Re-run failed jobs), no new tag needed.
  `npm whoami` locally still returns `401`, so a local publish needs `npm login` or an automation
  token instead; either route works, neither is done. That local route is exercised: today's
  `bash scripts/publish-codeitlab-cli.sh --dry-run` builds `codeitlab@0.1.1`, reports `7 files`
  and `+ codeitlab@0.1.1` without touching the registry. Tarball bytes are not reproducible
  (`shasum 5b64cde1…` from CI vs `5ed368c3…` from that local build), so only the version, file
  count and archive names are contract. Both workflows now fail fast when the tag's
  base version and `apps/server/package.json` disagree (a `-nightly.N` dispatch still passes) —
  that is the mismatch that made 0.1.0 ship two naming generations. Proved in CI, not just in a
  shell: dispatch 40422296264 asked for `version=0.1.2` against a `0.1.1` tree, step
  `Check the release manifests match the tagged version` failed with
  `apps/server/package.json is 0.1.1 but this run publishes 0.1.2; run node
scripts/update-release-package-versions.ts 0.1.2 and commit it before tagging`, and both the
  launcher build and the publish step were skipped.
- CLI 0.2.0 (current — one release line): `scripts/update-release-package-versions.ts 0.2.0`
  moved the four releasable manifests and `release-cli-archives.yml`'s dispatch defaults
  (`a2dfef80`), published as the parentless snapshot `cb95a0d5` on `main` with annotated tag
  `cli-v0.2.0` (`8e44b949`). Run `40430388529` (`Release CLI archives`) is green: 4/4 native legs
  plus `Attach archives to the release`. Release `v0.2.0` (id 424932318, published
  2026-10-27T01:10:09Z) carries exactly five assets —
  `codeitlab-0.2.0-darwin-arm64.tar.gz` 83,251,361 B (`3b8d729b...`), `-linux-arm64` 91,049,819 B
  (`6e60e741...`), `-linux-x64` 95,347,040 B (`797528bf...`), `-win32-x64.zip` 86,210,688 B
  (`d1250ccc...`) and a 4-line / 398 B `SHA256SUMS` (`d7ff78e4...`) whose four lines match the
  digests GitHub reports; all four differ from 0.1.0's and 0.1.1's, so these are rebuilds rather
  than re-uploads. `Publish CLI to npm` run `40430388743` built the `codeitlab@0.2.0` tarball
  (`7 files`) and stopped at the same human step, `npm error code ENEEDAUTH`; the local
  `bash scripts/publish-codeitlab-cli.sh --dry-run` also reports `7 files` / `+ codeitlab@0.2.0`
  without touching the registry. Releases `v0.1.0` and `v0.1.1` and the tags
  `v0.1.0`/`v0.1.1`/`cli-v0.1.0`/`cli-v0.1.1` were deleted so the Releases page has one answer to
  "what do I download". The cost is explicit: the published `codeitlab@0.1.0` tarball is pinned to
  `/releases/download/v0.1.0/cil-0.1.0-*`, so `npx codeitlab@0.1.0` — and unpinned `npx codeitlab`,
  which still resolves to `0.1.0` because npm's `latest` has not moved — now fails on that 404
  until `codeitlab@0.2.0` is on npm; `scripts/install.sh` reads the newest release and is
  unaffected. Measured, not assumed: an unpinned installer run into a scratch HOME after the
  deletion installed `0.2.0` and `cil --version` printed `codeitlab v0.2.0`, while
  `npx --yes codeitlab@0.1.0 --version` exited 1 with
  `.../releases/download/v0.1.0/SHA256SUMS does not exist yet`.
- Stray archive: `release-cli/cil-0.1.0-darwin-arm64.tar.gz` (81,864,219 B) had been committed in
  `90412fca`, so every matrix leg checked out an 82 MB legacy archive beside the fresh build,
  `path: release-cli/*` swept it into all four artifacts, the SHA256SUMS step hashed it, and
  `gh release upload --clobber` republished it over the legacy `cil-0.1.0-darwin-arm64.tar.gz`
  asset, adding a fifth checksum line that nothing in the build produced. `8947fe67` untracks it,
  ignores `release-cli/` and `cli-resource-monitor/`, uploads only `release-cli/codeitlab-*`, and
  fails the SHA256SUMS step on any non-`codeitlab-` archive instead of publishing it. The
  overwritten legacy asset cannot be restored (its original 82,835,218 B copy is gone) and is
  left in place; the other three `cil-0.1.0-*` assets are untouched, and `SHA256SUMS` is now
  exactly the four `codeitlab-` archives.
- GitHub: every `git push` from this clone failed with `remote: fatal: did not receive expected
object …` / `remote unpack failed: index-pack failed`. The clone is shallow (`.git/shallow`,
  175 commits), so the thin pack promised the server a base object it never sent; `git fsck
--full` is clean and that object exists in no pack. Fixed by pushing a parentless snapshot
  commit cut from HEAD's tree (`git commit-tree $(git rev-parse HEAD^{tree})`), which the remote
  accepted. `refs/heads/main` therefore carries the verified tree while local `main` keeps the
  real history. `git fetch --unshallow` would restore ordinary pushes at the cost of a large
  download.
- Legacy naming: the CLI archives ship the executable as `codeitlab` while the binary self-reports
  `codeitlab v0.1.0`; the installer and launcher symlink `codeitlab`/`cil` onto it, so this is
  cosmetic but worth knowing when auditing an install.
- Commit references: the SHAs above that are not `main` or `cli-v0.1.0` exist only in this local
  clone, because the fork publishes each state as a parentless snapshot: `GET
/repos/rumbis/codeitlab/commits/<sha>` answers 422 for `fb8728f0`, `57c2494c`, `cc5ce441`,
  `752d7fd6`, `c49d71f8`, `8947fe67` and `703697f2`. What GitHub can resolve: `00f3d63a` (= annotated
  tag `cli-v0.1.0`, the green archives run), `0f9eed5f` (= `main`), and the earlier `main` tips
  `1dd18e8c` / `a5259c47`, which no ref points at any more. The playwright fix and the stray-archive
  fix both live in `00f3d63a`'s tree; this STATUS rewrite lives in `0f9eed5f`'s. `git ls-remote
origin` listed exactly two refs at that point: `refs/heads/main` and `refs/tags/cli-v0.1.0`.
- Desktop 0.2.0 (current): `./node_modules/.bin/vp run build:desktop` (exit 0) plus
  `node apps/desktop/scripts/package-codeitlab-app.mjs --output /Applications/CodeItLab.app`
  (exit 0) replaced the installed app, which had been the 0.1.1 bundle since the previous round.
  The new bundle reports `CFBundleShortVersionString`/`CFBundleVersion` `0.2.0`, bundle id
  `com.codeitlab.app`, staged root `package.json` `codeitlab@0.2.0`, 469 MB, with the 40 staged runtime
  externals (`node-pty`, `playwright-core`, `@cursor/sdk`, …) and a freshly built client at
  `Contents/Resources/app/apps/server/dist/client/` that carries the CodeItLab pages and the
  marketplace code. The previous bundle is kept at `release/CodeItLab-0.1.1-backup.app`, and the
  0.1.0 backup was deleted. It was not launched: GUI verification is the one step that needs the
  developer's agreement, so the 0.1.0
  round's launch plus 846/846 file-identity check remains the last executed app run.
- Re-verified from the outside after the 0.1.1 cut (historical — that release and `v0.1.0` were
  deleted afterwards; task-40, ledger `/tmp/verify-011-report.md`,
  evidence `/tmp/verify-011/`, 6/6 PASS, repo untouched): release `v0.1.1` shipped the
  five assets listed above; `shasum -a 256 -c` passed 4/4 with digests `ae46ba9f...`
  (darwin-arm64), `630be5ca...` (linux-arm64), `a1b89346...` (linux-x64), `86c0c828...`
  (win32-x64) — all four differ from 0.1.0's, so these are genuine rebuilds, not re-uploads. Every
  leg's `[cli-archive] Wrote ...` size equals the released byte count 4/4, and the narrowed upload
  command (`release-cli/codeitlab-* release-cli/SHA256SUMS --clobber`) kept the stray guard quiet.
  The installer was run for real against the published archive
  (`env HOME=… CIL_VERSION=0.1.1 … sh scripts/install.sh`): exit 0, `Installed CodeItLab 0.1.1`,
  `.install-complete`=0.1.1, `cil`/`codeitlab`/`codeitlab` all report `codeitlab v0.1.1` with empty
  stderr, and the installed `codeitlab` sha256 `a6c34f2b...` is byte-identical (`cmp`) to the `codeitlab` member
  extracted from the downloaded `codeitlab-0.1.1-darwin-arm64.tar.gz` (164,202,400 B). The launcher
  formula at `codeitlab.mjs:96` resolves `codeitlab-<version>-<platform>-<arch>` for exactly the
  four assets 0.1.1 published and then requires the name to appear in
  `<base>/v<version>/SHA256SUMS`. Two notes that still apply: `SUPPORTED` in the launcher lists
  `win32-arm64`, which has no published asset and instead prints the scripted "no CodeItLab CLI
  build is available for win32-arm64" message — deferred decision, either add a
  `windows-11-arm` leg or map Windows ARM to the x64 archive; and a `cli-v*` push always publishes
  to the `latest` dist-tag, so a pre-release must go through a `workflow_dispatch` with
  `dist_tag`. npm itself is still at `dist-tags { latest: 0.1.0 }` with `npm view codeitlab@0.2.0`
  → 404, which is the expected state before the trusted publisher exists.
- Re-verified from the outside after the fix (historical — `v0.1.0` was deleted afterwards; run
  40418137528, `Release CLI archives`, head `00f3d63a`, all 5 jobs success): release `v0.1.0`'s
  `SHA256SUMS` was 4 lines / 398 B, all four
  names `codeitlab-0.1.0-*`, digests `7b6f2b4d…` (darwin-arm64), `85df2316…` (linux-arm64),
  `fc0dd2b9…` (linux-x64), `51c10830…` (win32-x64), each reproduced by an independent
  `shasum -a 256 -c`; every build leg logged only its own archive
  (`[cli-archive] Wrote release-cli/codeitlab-0.1.0-…`) at the size the release showed. The legacy
  `cil-0.1.0-darwin-arm64.tar.gz` asset carried its previous-run timestamps (`created_at`
  22:57:20Z, `updated_at` 22:57:26Z, 81,864,219 B) against this run's 23:12:26–23:18:04Z window, and
  artifact sizes fell from ~archive+82 MB to ~archive.

Added in this round: `test(codeitlab): pin the marketplace request timeout` (`57c2494c`). The
bridge's 10s timeout was wired but unasserted, so deleting `Effect.timeout` would have left the
suite green while a silent marketplace kept the apply spinner turning. The test drives an
injected client that never answers and advances the test clock past the deadline; with the
timeout deleted it hangs and fails. `EngagementsService.test.ts` 40/40, `vp lint` 0 warnings.

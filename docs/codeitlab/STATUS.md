# CodeitLab — status of the whole picture

This is the honest map: every promise in the objective, where it lives, and what
proves it. Written after the marketplace reached its current state (schema 23,
291 marketplace tests, 281 main-app CodeitLab tests).

## What CodeitLab is today

A fork of an MIT-licensed agent harness that brands everything a person sees as
**CodeitLab**. User-facing names are `codeitlab`/`cil`, `CIL_*` environment
variables and `~/.cil`; the legacy `t3` command, `T3CODE_*` names and `~/.t3`
are accepted for existing installs. Workspace package names (`@t3tools/*`) and
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
| Unified harness for every ACP (Hermes, Qoder, Claude, Codex, Cursor, Grok, Muse, OpenCode, Pi) | `packages/provider-acp*`, `apps/server/src/codeitlab/agents`, harness matrix                                           | `docs/codeitlab/HARNESS-MATRIX.md`, 33 CodeitLab test files                                |
| Skills, sessions and MCP from every ACP                                                        | `apps/server/src/codeitlab/ecosystem`, `sessions`, `mcp`                                                               | `docs/codeitlab/ECOSYSTEM.md`, `SESSION-HISTORY.md`                                        |
| Welcome step listing active agents                                                             | web onboarding + agents panel                                                                                          | `apps/web/src/codeitlab/agents*`                                                           |
| 3D/animated UI, effects, SFX                                                                   | `ambientScene`, `effectsSettings`, `audio`                                                                             | `docs/codeitlab/FEATURE-SPEC.md`                                                           |
| DeepSeek-like memory                                                                           | `apps/server/src/codeitlab/memory`, `packages/codeitlab/src/memory.ts`                                                 | `MEMORY-WHITELABEL.md`                                                                     |
| Own panel                                                                                      | `/settings/codeitlab/*` (24 sections)                                                                                  | `apps/web/src/codeitlab/panel.ts`                                                          |
| Uncensored toggle                                                                              | `/settings/codeitlab/uncensored`                                                                                       | same panel registry                                                                        |
| REA (evidence-driven review)                                                                   | `packages/codeitlab/src/rea.ts`, `apps/server/src/codeitlab/rea`                                                       | `REA-EVIDENCE.md`                                                                          |
| Quota-aware router (OmniRoute idea)                                                            | `apps/server/src/codeitlab/routing` (health, scoring, classify)                                                        | `MEMORY-REA-ROUTING.md`                                                                    |
| Studio: decks and video from code                                                              | `packages/codeitlab/src/studio`, `apps/web/src/components/studio`                                                      | `STUDIO.md`                                                                                |
| Shorts clip jobs, OpenShorts/Rakazo/ModSearch                                                  | `apps/server/src/codeitlab/integrations` (clip jobs, tools), settings section                                          | integrations + quests tests, `INTEGRATIONS.md`                                             |
| Model-picker search                                                                            | `apps/web/src/codeitlab/autoRouterLabel`, model picker                                                                 | web tests                                                                                  |
| Own npm package                                                                                | `scripts/npm-launcher/codeitlab.mjs` → `codeitlab@0.1.0`                                                               | rebuilt and ran `codeitlab v0.1.0` this round                                              |
| Publish guide + one command                                                                    | `docs/codeitlab/PUBLISH-NPM.md`, `scripts/publish-codeitlab-cli.sh`                                                    | docs                                                                                       |
| GitHub repo                                                                                    | `github.com/rumbis/codeitlab`, `main` is orphan snapshots                                                              | `git log origin/main`                                                                      |
| Marketplace with escrow                                                                        | `apps/marketplace/src/server/engagements.ts`, migrations 1–22                                                          | 291 tests, 63 files                                                                        |
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

| Wave | Item                          | State                                                                                                                              | Verified by                                                                                                                                                                                        |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | G11 measured startup baseline | done                                                                                                                               | `scripts/bench-startup.mjs`, `PERFORMANCE.md`                                                                                                                                                      |
| 0    | G7 quick overlay launcher     | done                                                                                                                               | `QuickOverlayLauncher.browser.test.tsx`, `apps/desktop/src/window/QuickOverlayShortcut.test.ts`                                                                                                    |
| 1    | G2 agent teams                | done: presets, run cards with one row per worker, synthesis, aggregated changed files, composer entry                              | `packages/codeitlab/src/team.test.ts`, `apps/web/src/codeitlab/team.test.ts`, `CodeitlabTeamPage.browser.test.tsx`, `CodeitlabTeamRunCard.browser.test.tsx`, `ComposerTeamsEntry.browser.test.tsx` |
| 1    | G1 kanban board               | done: board UI, migration 068, repository, `CodeitlabTasksService`, ws methods, database-first dual read                           | board schema/actions tests, `CodeitlabTasks.test.ts`, `TasksService.test.ts`, migration tests, `CodeitlabBoardPage.browser.test.tsx`, sidebar chip tests                                           |
| 2    | G5 deploy menu                | done                                                                                                                               | `packages/codeitlab/src/deploy.test.ts`, `CodeitlabDeployPage.browser.test.tsx`                                                                                                                    |
| 2    | G3 bots                       | local chat done; Telegram and per-bot schedules need a bot token                                                                   | `packages/codeitlab/src/bots.test.ts`, `CodeitlabBotsPage.browser.test.tsx`                                                                                                                        |
| 3    | G12 per-model context size    | done                                                                                                                               | `packages/codeitlab/src/context.test.ts`, `apps/web/src/lib/contextWindow.test.ts`, `CodeitlabContextPage.browser.test.tsx`                                                                        |
| 3    | G8 goal budget                | done (a warning, never a stop)                                                                                                     | `packages/codeitlab/src/budget.test.ts`, `CodeitlabBudgetPage.browser.test.tsx`                                                                                                                    |
| 3    | G9 issues                     | local list done; no GitHub sync                                                                                                    | `packages/codeitlab/src/issues.test.ts`, `CodeitlabIssuesPage.browser.test.tsx`                                                                                                                    |
| 3    | G6 mood boards + sketch       | done                                                                                                                               | `packages/codeitlab/src/moodboard.test.ts`, `sketch.test.ts`, `CodeitlabMoodBoardPage.browser.test.tsx`, `CodeitlabSketchPage.browser.test.tsx`                                                    |
| 4    | G10 wallpapers                | done, opt-in, contrast-safe                                                                                                        | `packages/codeitlab/src/wallpaper.test.ts`, `CodeitlabWallpaperPage.browser.test.tsx`                                                                                                              |
| 4    | G4 Tart sandbox + MCP tools   | blocked: the `tart` CLI is not installed here, and installing it plus VM images is a machine-level decision, so nothing is stubbed | —                                                                                                                                                                                                  |

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
| `vp lint` (298 CodeitLab + marketplace files)                                     | **0 warnings, 0 errors**, `vp fmt --check` clean                                                                                                                   |
| `vp test run scripts/build-npm-launcher.test.ts`                                  | **3 passed** (download, SHA256 verify, cache, run — realpath-safe on macOS)                                                                                        |
| `vp test run packages/codeitlab/src/credentials …`                                | **33 passed** — secrets masked by default, personal data opt-in, explicit rule gating                                                                              |
| `vp test run …/credentials … RunExecutionService.test.ts`                         | **75 passed** — masking, restore round trip, restore at the ingestion boundary                                                                                     |
| `vp test run apps/server/src/textGeneration`                                      | **98 passed** — app-initiated generation masks credentials and restores results                                                                                    |
| `vp lint` (CodeitLab code)                                                        | **0 warnings, 0 errors** (packages/codeitlab, apps/server/src/codeitlab, apps/web/src/codeitlab)                                                                   |
| Marketplace boot with a file DB                                                   | `/`, `/jobs`, `/coders`, `/how-it-works`, `/numbers`, `/sitemap.xml`, `/robots.txt`, `/.well-known/security.txt`, `/manifest.webmanifest`, `/health` → all **200** |
| npm launcher build                                                                | package tree + tarball built; `codeitlab --version` → `codeitlab v0.1.0`                                                                                           |
| Privacy firewall defaults                                                         | **on** for secrets and personal data; app turns, app-initiated generation and the gateway all mask and restore                                                     |
| Remote `main`                                                                     | orphan snapshot, always a superset of the validated tree                                                                                                           |

| `vp test run` — parity feature units (board, bots, budget, context, deploy, issues, mood, wallpaper, team, context window) | **89 passed** (16 files) |
| `vp test run --project browser` — CodeItLab surfaces (board, bots, deploy, context, mood, budget, issues, wallpaper, team run, sidebar chips) | **66 passed** (15 files) |
| `tsc-rs --noEmit` (`@t3tools/web`) after each parity feature | clean |

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
- **Renaming release archives `t3-…` → `codeitlab-…`** — the desktop updater, CI
  and the already-published npm 0.1.0 all agree on the current names; renaming
  needs a fallback release, not a blind edit.
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

## The rename

The `t3` → `cil` work is tracked in [RENAME.md](./RENAME.md): what has moved, and
the three surfaces that deliberately wait for a fallback release or a real domain.

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
`apps/web/src/components/codeitlab` currently total 97.

## Marketplace copy is checked against the server

`apps/web/src/components/codeitlab/marketplaceFees.test.ts` reads the marketplace
contracts from disk and fails if the panel's fee percentages drift, if a stored
escrow state is missing from the legend, or if the panel invents a state the
server never stores. `marketplace.md` lists the same eight states.

## Motion budget is guarded

`apps/web/src/codeitlab/motionBudget.test.ts` reads the stylesheet: the panel
entrance must stay inside 120-200 ms, and the reduced-motion branches for the
entrance and the sheet primitive must exist. The sheet's Tailwind transition
gained that branch this round.

## Rename drift is checked

`renameDrift.test.ts` fails if `docs/user` or the CodeItLab panels mention `t3`
outside the staged technical ids, which are listed in RENAME.md and in the test's
allowlist. This round also replaced the remaining product-name prose in 14 user
docs and moved the MCP server examples to `cil`.

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
`CodeitlabOverviewPage.browser.test.tsx` (click writes settings and mirrors to the
database). See [quests.md](../user/quests.md).

## Completion time is its own field

`completedAt` is written when a task enters Completed and cleared when it leaves,
so editing notes on a finished task neither moves its streak day nor restarts the
seven-day archive clock. Migration 069 adds the column; old rows fall back to
`updatedAt`. Covered by `packages/codeitlab/src/progress.test.ts`,
`apps/web/src/codeitlab/board.test.ts` and `apps/server/src/persistence/CodeitlabTasks.test.ts`.

## Board progress (gamification that is not a game)

Completed count and a UTC-day streak, computed from the board's own tasks:
`packages/codeitlab/src/progress.ts`, four unit tests, and a browser test for the
card. Deliberately no points or badges, and the card says what it counts.

## Profile (interest domain + skillset)

The declaration the vision asks for exists as its own panel section:
`CodeitlabProfileSettings` (local, user-written) with `profileBrief` producing a
labelled block for agent context. The page previews the exact lines, and an empty
profile produces no block at all, and starting a bot chat appends that block to the
bot brief. Verified by `packages/codeitlab/src/profile.test.ts`,
`packages/codeitlab/src/bots.test.ts` and `CodeitlabProfilePage.browser.test.tsx`. See [profile.md](../user/profile.md).

## Honest limits

Every bounded behaviour and every blocked item is collected in [LIMITS.md](./LIMITS.md),
with the reason it is not done and what the app does instead.

## Verification snapshot (2026-10-24)

Run on this machine, on the commit that carries this line, with
`vp test run` (never repo-wide):

| Batch                                                                                                                              | Files | Result |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| `packages/codeitlab` parity units (board, team, deploy, bots, context, mood, budget, issues, wallpaper, sketch, profile, progress) | 12    | passed |
| `apps/web` parity units (board actions, team actions, panel registry, fee copy, rename drift)                                      | 5     | passed |
| `packages/shared` rename units (worktree refs, env aliases)                                                                        | 2     | passed |
| CodeItLab browser suite (`apps/web/src/components/codeitlab`)                                                                      | 19    | passed |

Totals: **133 unit tests** and **95 browser tests** green in this run. The
"Verified by" column above names the files; this table says they were actually
executed on this date.

## Marketplace copy is checked against the server

`apps/web/src/components/codeitlab/marketplaceFees.test.ts` reads the marketplace
contracts from disk and fails if the panel's fee percentages drift, if a stored
escrow state is missing from the legend, or if the panel invents a state the
server never stores. `marketplace.md` lists the same eight states.

## Motion budget is guarded

`apps/web/src/codeitlab/motionBudget.test.ts` reads the stylesheet: the panel
entrance must stay inside 120-200 ms, and the reduced-motion branches for the
entrance and the sheet primitive must exist. The sheet's Tailwind transition
gained that branch this round.

## Rename drift is checked

`renameDrift.test.ts` fails if `docs/user` or the CodeItLab panels mention `t3`
outside the staged technical ids, which are listed in RENAME.md and in the test's
allowlist. This round also replaced the remaining product-name prose in 14 user
docs and moved the MCP server examples to `cil`.

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
`CodeitlabOverviewPage.browser.test.tsx` (click writes settings and mirrors to the
database). See [quests.md](../user/quests.md).

## Completion time is its own field

`completedAt` is written when a task enters Completed and cleared when it leaves,
so editing notes on a finished task neither moves its streak day nor restarts the
seven-day archive clock. Migration 069 adds the column; old rows fall back to
`updatedAt`. Covered by `packages/codeitlab/src/progress.test.ts`,
`apps/web/src/codeitlab/board.test.ts` and `apps/server/src/persistence/CodeitlabTasks.test.ts`.

## Board progress (gamification that is not a game)

Completed count and a UTC-day streak, computed from the board's own tasks:
`packages/codeitlab/src/progress.ts`, four unit tests, and a browser test for the
card. Deliberately no points or badges, and the card says what it counts.

## Profile (interest domain + skillset)

The declaration the vision asks for exists as its own panel section:
`CodeitlabProfileSettings` (local, user-written) with `profileBrief` producing a
labelled block for agent context. The page previews the exact lines, and an empty
profile produces no block at all, and starting a bot chat appends that block to the
bot brief. Verified by `packages/codeitlab/src/profile.test.ts`,
`packages/codeitlab/src/bots.test.ts` and `CodeitlabProfilePage.browser.test.tsx`. See [profile.md](../user/profile.md).

## Honest limits

Every bounded behaviour and every blocked item is collected in [LIMITS.md](./LIMITS.md),
with the reason it is not done and what the app does instead.

## Verification snapshot (2026-10-24)

Run on this machine, on the commit that carries this line, with
`vp test run` (never repo-wide):

| Batch                                                                                                           | Files | Result |
| --------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| `packages/codeitlab` parity units (board, team, deploy, bots, context, mood, budget, issues, wallpaper, sketch) | 10    | passed |
| `apps/web` parity units (board actions, team actions, panel registry)                                           | 3     | passed |
| `apps/server` board storage (repository, service, migrations)                                                   | 3     | passed |
| CodeItLab browser suite (`apps/web/src/components/codeitlab`)                                                   | 17    | passed |

Totals: **81 unit tests** and **87 browser tests** green in this run. The
"Verified by" column above names the files; this table says they were actually
executed on this date.

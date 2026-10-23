# codeitlab build plan

Ordered phases, file ownership, and gates for shipping the codeitlab features in this fork. Written
against the repo's actual state, not a greenfield: the contract package and settings plumbing already
exist (see "Starting state"), and every teammate shares **one working tree** — coordination is
file-level, not branch-level.

Rules that make parallel work safe:

1. **One writer per file.** A path has exactly one owner for the duration of a phase. If a change
   crosses into another owner's file, the owner makes it (or hands the file over explicitly).
2. **Contracts are frozen per module.** `packages/codeitlab/src/*.ts` is split by owner; shared glue
   (`settings.ts`, `services.ts`, `index.ts`, `package.json`) is build-eng only. Additive schema
   changes after the freeze are requested from the module owner and applied once, with a decoding
   default so old settings still decode.
3. **Package manifests and the lockfile have one owner: build-eng.** Nobody else runs `vp i`, edits
   `pnpm-lock.yaml`, `pnpm-workspace.yaml`, or a root `package.json`. Dependency requests go to
   build-eng, who installs once and reports the lockfile commit.
4. **Migration numbers are allocated, not invented.** build-eng allocates the next number; the
   feature owner creates exactly that file and never renumbers.
5. **No repo-wide checks.** Each owner runs scoped `vp test run <files>`, scoped lint, scoped
   typecheck. The Lead runs the integrated pass.
6. **No teammate starts a dev server, browser, or computer-use session.** The Lead does the one
   integrated client pass after integration (per AGENTS.md).
7. **Git is the Lead's.** The tree is currently a detached HEAD; the Lead creates a branch before
   the first commit and commits at each phase gate. Teammates never commit, rebase, or stash.

## Starting state (verified in the working tree)

| Artifact                                                                                 | State                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/codeitlab/` (`@codeitlab/core`)                                                | **exists** — `settings.ts`, `nexus.ts`, `memory.ts`, `routing.ts`, `policy.ts`, `rea.ts`, `services.ts`, `index.ts`, `package.json` with subpath exports                                       |
| `packages/contracts/src/codeitlab.ts`                                                    | re-exports `@codeitlab/core`                                                                                                                                                                   |
| `packages/contracts/src/index.ts`                                                        | exports `./codeitlab.ts`                                                                                                                                                                       |
| `packages/contracts/src/settings.ts`                                                     | `ServerSettings.codeitlab` added (with decoding default); `ServerSettingsPatch.codeitlab` optional                                                                                             |
| `apps/server/package.json`, `apps/web/package.json`, `packages/contracts/package.json`   | depend on `@codeitlab/core: workspace:*`                                                                                                                                                       |
| `apps/web/package.json`                                                                  | `three` 0.180.0 + `@types/three` 0.180.0 added                                                                                                                                                 |
| `pnpm-lock.yaml`                                                                         | modified, needs one `vp i` by build-eng                                                                                                                                                        |
| Server feature code (`apps/server/src/{nexus,memory,routing,policy,rea,execution}`)      | **not started**                                                                                                                                                                                |
| Web feature code (`components/{three,audio,control,nexus,memory}`, `routes/control.tsx`) | **not started**                                                                                                                                                                                |
| Teammates                                                                                | lead, build-eng, ui-eng (+ arch-research docs). nexus-eng and memory-eng are not spawned yet; this plan assumes the Lead spawns them, otherwise build-eng absorbs those tracks in phase order. |

## Phase 0 — contract freeze (build-eng) — _largely done_

Deliverables: the `@codeitlab/core` modules above, `ServerSettings.codeitlab` wiring, workspace deps,
one `vp i`, scoped typecheck of `packages/codeitlab` + `packages/contracts`.

Fix before freeze:

- `rea.mcpArgs` default is wrong: `rea mcp` only has `add`/`doctor`; the stdio server is
  `rea --mcp` (verified on `rea` 6.7.0 at `/opt/homebrew/bin/rea`). Default `mcpCommand: "rea"`,
  `mcpArgs: ["--mcp"]`, fallback `npx -y rea-agents@6.7.0 --mcp`.
- `routing.omniRoute.baseUrl` default `http://127.0.0.1:20128` — the real endpoint on this machine
  is `http://100.86.11.88:20128` (tailnet; `/v1/models` → 401 without a key, `/health` → 404). Make
  the default configurable and seed the 45 `auto/*` virtual models (see `ECOSYSTEM.md`).
- Confirm `CodeitlabSettings` decodes `{}` and an old `settings.json` without the key.

Gate: `vp run typecheck` scoped to the two packages passes; `vp test run` on
`packages/codeitlab` passes; no feature code merged yet.

## Phase 1 — server foundations (build-eng, blocks the feature tracks)

Goal: make the service tags real and reachable before features land, so feature owners only add
files inside their own directories.

| Area                 | Files (build-eng)                                                                     | Deliverable                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service layers       | `apps/server/src/codeitlab/CodeitlabServices.ts` (new), `apps/server/src/server.ts`   | `Layer.mergeAll` of the six `@codeitlab/core/services` tags, provided at the server composition root                                                                                         |
| RPC                  | `packages/contracts/src/rpc.ts` (`WS_METHODS`), `apps/server/src/ws.ts`, `WsRpcGroup` | `codeitlab.nexus.*`, `codeitlab.memory.*`, `codeitlab.routing.*`, `codeitlab.policy.*`, `codeitlab.rea.*` methods; mutations via `createEnvironmentRpcCommand` + `CLIENT_GUARDED_RPC_SCOPES` |
| MCP registration     | `apps/server/src/mcp/McpHttpServer.ts`, `McpSessionRegistry.ts`                       | toolkits `nexus`, `memory`, `rea` registered per thread; capability checks via `McpToolAccess`                                                                                               |
| Migrations           | `apps/server/src/persistence/Migrations/`                                             | allocate numbers (e.g. `00NN_codeitlab_memory.ts`, `00NN_codeitlab_rea_evidence.ts`, `00NN_codeitlab_routing_history.ts`); create the runner entries                                         |
| Feature flags        | `apps/server/src/settings/…`                                                          | read `ServerSettings.codeitlab` once, expose typed accessors; no feature reads raw settings                                                                                                  |
| Provider launch seam | `apps/server/src/provider/…`                                                          | a single `CodeitlabTurnContextService` call site in the turn starter so features do not each patch adapters                                                                                  |

Gate: server boots with all services stubbed; `ws.test.ts` passes for the new methods; a
`codeitlab.memory.stats` call returns zeros from a fresh DB; no UI changes required yet.

## Phase 2 — parallel feature tracks

Four independent tracks. Each owner works only inside their scope and runs scoped checks.

### Track A — Nexus (nexus-eng)

Write scope: `packages/codeitlab/src/nexus.ts`, `apps/server/src/nexus/**`,
`apps/server/src/mcp/toolkits/nexus/**`, colocated tests.

Order: source registry + filesystem skill scanner → ACP probe source → native session readers →
MCP config readers → merge/dedupe → import → refresh worker → RPC handlers (thin) → MCP tools.

Definition of done: `NexusService.catalog`/`refresh` return a real catalog from the two harnesses
configured on this machine (Hermes, Claude); duplicate skills collapse with `alsoAvailableIn`;
sessions from Claude/Codex/DSH/Hermes list with correct metadata; import is idempotent; no config
file mtime changes; canary secret never appears in a payload.

### Track B — Memory (memory-eng)

Write scope: `packages/codeitlab/src/memory.ts`, `apps/server/src/memory/**`,
`apps/server/src/mcp/toolkits/memory/**`, **one** allocated migration file, colocated tests.

Order: migration + store (FTS5) → service layer → recall → extractor (behind a text-generation
interface so tests use a fake) → post-settlement effect wiring → MCP tools → stats/export.

Definition of done: cross-thread recall works in one project and not across projects; dedupe and
redaction tests pass; extraction is rate-limited and cancellable; disabling memory stops both paths;
`memory.stats` reflects reality.

### Track C — UI shell, effects, control panel (ui-eng)

Write scope: `apps/web/src/**` (with the shared-file exceptions below), specifically
`components/three/**`, `audio/**`, `components/control/**`, `components/nexus/**`,
`components/memory/**`, `routes/control.tsx`, `routes/settings.{nexus,memory,policy,rea,boost}.tsx`,
theme tokens in `apps/web/src/index.css`, `state/` atoms for the new RPCs.

Shared-file exceptions (ui-eng may edit, nobody else): `apps/web/src/index.css`,
`apps/web/src/themePalette.ts`, `apps/web/src/routes/settings.tsx` (nav entry),
`apps/web/src/components/AppSidebarLayout.tsx` (nav entry). build-eng owns `apps/web/package.json`
(deps already added).

Order: theme tokens + control panel shell with mocked RPC → effects settings (3D/SFX) → Nexus
browser → Memory tab → settings pages for routing/policy/REA → wire to real RPCs as tracks land.

Definition of done: control panel renders all cards with real data; idle 3D produces zero rAF
callbacks after timeout; `threeD: "off"`/reduced-motion never imports three.js; SFX gated on gesture;
settings round-trip through the existing settings RPC; empty/error/loading states exist; no
continuous animation outside `components/three/`.

### Track D — Routing, policy, REA, ecosystem (build-eng)

Write scope: `packages/codeitlab/src/{routing,policy,rea}.ts`, `apps/server/src/{routing,policy,rea}/**`,
`apps/server/src/ecosystem/**`, `apps/server/src/mcp/toolkits/{routing,rea}/**`, plus the
`CodeitlabContextService` implementation in `apps/server/src/codeitlab/`.

Order: routing service (catalog/decide/history + classifier) → policy service (profiles, support
matrix, audit) → REA service (installer/status/health, evidence store, auto-activation) → ecosystem
(OmniRoute probe, Graft lifecycle, Ponytail/Caveman packs) → `buildTurnContext` composition.

Definition of done: `decide` is pure and never picks an unavailable instance; policy reports
unsupported providers honestly; REA registers `rea --mcp`, seeds the skill, and reports health;
OmniRoute probe handles 401 as "auth required"; `buildTurnContext` returns instructions composed in
the fixed order (policy packs → memory → nexus summary) with a token cap.

## Phase 3 — integration (Lead + build-eng)

1. **Compose the turn context.** One call site in the turn starter; assert order and token cap; the
   decision is persisted on the turn.
2. **Settings surface.** Every feature section renders and round-trips; `ServerSettingsPatch`
   whole-struct replacement verified.
3. **Events.** `nexus.catalog.changed`, `memory.entry.written`, `routing.decision.recorded`,
   `policy.changed`, `rea.status.changed` reach the client; no polling added.
4. **Surfaces.** Web + desktop (desktop wraps web). Mobile: decide explicitly — read-only control
   panel or "not available on mobile"; document the decision rather than silently missing it.
5. **One integrated client pass** by the Lead (`test-t3-app` web + desktop), including the 3D idle
   check and the settings pages.

Gate: scoped tests green, one browser pass with no console errors, and the acceptance criteria in
`FEATURE-SPEC.md` spot-checked.

## Phase 4 — real-world verification (Lead)

1. **Hermes ACP end-to-end.** Add a local ACP instance (`command: /Users/rumbis/.local/bin/hermes`,
   `args: ["acp"]`), initialize, one prompt, one tool call. `--accept-hooks` is required for
   headless launch and is a security decision — expose it as an instance setting, never a default.
2. **REA.** `rea --mcp` registers; `rea doctor` + `rea mcp doctor` health; one analysis of
   `/Applications/T3 Code (Beta).app`; evidence cache hit on the second run.
3. **Graft.** `graft mcp <root>` registered for a real repo; `graft build` job; `graft check`
   freshness.
4. **OmniRoute.** With a key, `GET /v1/models` populates the catalog; one routed turn through
   `auto/best-coding-fast`; 401 path shows the settings row, not a crash.
5. **DSH ACP.** Confirm the exact argv (`dsh --profile acp` per the runtime docs) before shipping
   the instance preset.
6. **Memory.** Two threads, one project; fact recalled; no cross-project leak; export/import.

## Ownership map (one screen)

| Owner      | Owns (write)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Never writes                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| build-eng  | `packages/codeitlab/src/{settings,services,index,routing,policy,rea}.ts`, `packages/codeitlab/package.json`, `packages/contracts/src/{index,settings,codeitlab}.ts`, `packages/contracts/package.json`, `apps/server/src/{server,ws,bootstrap,codeitlab}/**`, `apps/server/src/mcp/**`, `apps/server/src/persistence/Migrations/**` (allocates numbers), `apps/server/package.json`, `apps/web/package.json`, root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/server/src/{routing,policy,rea,ecosystem}/**`, `apps/server/src/mcp/toolkits/{routing,rea}/**` | `apps/web/src/**` feature components, `packages/codeitlab/src/{nexus,memory}.ts` |
| nexus-eng  | `packages/codeitlab/src/nexus.ts`, `apps/server/src/nexus/**`, `apps/server/src/mcp/toolkits/nexus/**`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | everything else, especially contracts glue and migrations                        |
| memory-eng | `packages/codeitlab/src/memory.ts`, `apps/server/src/memory/**`, `apps/server/src/mcp/toolkits/memory/**`, the one allocated migration file                                                                                                                                                                                                                                                                                                                                                                                                                                      | everything else                                                                  |
| ui-eng     | `apps/web/src/components/{three,audio,control,nexus,memory}/**`, `apps/web/src/routes/{control,settings.nexus,settings.memory,settings.policy,settings.rea,settings.boost}.tsx`, `apps/web/src/{index.css,themePalette.ts}`, `apps/web/src/state/{nexus,memory,routing,policy,rea}.ts`, `apps/web/src/routes/settings.tsx` + `components/AppSidebarLayout.tsx` (nav only)                                                                                                                                                                                                        | `apps/server/**`, `packages/**`, `apps/web/package.json`, lockfile               |
| lead       | docs (`docs/codeitlab/**`), git/commits, integration edits it explicitly takes, final verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | feature directories owned above                                                  |

When a change needs another owner's file: the owner makes it, or the Lead reassigns that file for the
phase. Do not edit across the line and "fix it later" — with a shared tree there is no merge to
recover it.

## Dependency graph

```
P0 contracts (build-eng) ──► P1 foundations (build-eng) ──┬─► A Nexus (nexus-eng) ─┐
                                                          ├─► B Memory (memory-eng) ─┼─► P3 integration (Lead+build-eng) ─► P4 verification
                                                          ├─► C UI (ui-eng) ─────────┘
                                                          └─► D routing/policy/REA/ecosystem (build-eng) ─┘
```

Hard dependencies: UI RPC wiring waits on P1 (schemas can be mocked earlier); `buildTurnContext`
composition waits on A/B/D service layers; control-panel data waits on P1 + C; ecosystem packs wait
on D's policy service.

## Risk register

| Risk                                                   | Impact                                           | Mitigation / owner                                                                     |
| ------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| REA MCP default is wrong (`mcp` vs `--mcp`)            | installer ships broken                           | fix in P0 contract (build-eng); verify `rea mcp doctor`                                |
| Hermes local ACP needs `--accept-hooks` headless       | blocks ACP end-to-end                            | instance setting, explicit consent; P4 test (Lead)                                     |
| DSH ACP argv unverified (`dsh --profile acp`)          | wrong preset                                     | confirm against bundled runtime before shipping (build-eng)                            |
| OmniRoute key absent; tailnet URL differs from default | routing mode looks broken                        | probe → "auth required" row; default URL configurable; P4 test                         |
| ACP does not standardize skills                        | Nexus skills missing for generic agents          | surface as `NexusCatalog.warnings`; only scan known roots                              |
| Memory extraction needs a small model                  | silent no-op if unset                            | gate on a configured text-generation provider; status row in settings                  |
| Uncensored mode over-promises                          | user trust + provider policy conflict            | `EffectivePolicy.limitations` + `unsupported[]`; never claim to bypass provider policy |
| 3D/SFX regress the "no continuous animation" rule      | performance regression (explicit AGENTS.md rule) | idle-to-zero acceptance test; `threeD: "off"` path; Lead review                        |
| Shared-tree collisions                                 | lost work, broken typecheck                      | one writer per file; build-eng owns manifests/lockfile; Lead commits at gates          |
| Migrations collide                                     | DB failure on upgrade                            | build-eng allocates numbers sequentially; one migration per feature                    |
| `three` added but not installed                        | typecheck/import failures                        | build-eng runs `vp i` once after P0 and reports                                        |
| Mobile surface missing                                 | "hit every surface" defect                       | explicit decision in P3: read-only control panel or documented unavailable             |

## Definition of done (all tracks)

- Scoped typecheck, lint, and tests pass for every touched package; no repo-wide run.
- No new continuous animation; no polling where an event exists; no spinner without an honest state.
- Settings round-trip; feature disabled = no behavior and no injection.
- Unsupported provider/transport states are explicit in the UI and in contracts (`unsupported`,
  `warnings`, `limitations`).
- Secrets never cross the wire (`envKeys` only), never written to disk in plaintext.
- Docs updated only where the change makes existing guidance wrong (`docs/internals/` for durable
  constraints); `docs/codeitlab/*.md` are working specs for this effort — the Lead decides whether
  they are committed (AGENTS.md says not to commit plans/research notes).

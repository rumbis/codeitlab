# Memory, REA, Policy and Auto-Routing

This document records the implementation decisions behind CodeItLab's four
turn-shaping features and how they compose into one injected instruction block.
The code is the source of truth; this page covers the constraints that are not
obvious from reading it.

## Memory

Persistent, per-environment memory under `<stateDir>/codeitlab/memory/`:

- `memory.jsonl` — one `MemoryEntry` per line. The whole corpus is held in memory
  because `maxEntries` bounds it; recall is a scan over a few thousand short
  strings, cheaper than an FTS index across processes.
- `meta.json` — `lastExtractionAt` for the extraction cadence.

Writes are serialized with a semaphore and go through
`writeFileStringAtomically` (temp file + rename), so a crash mid-write cannot
truncate the corpus. Loads skip malformed JSONL lines rather than losing the
whole corpus, and a load failure logs and starts empty.

Scopes: `global` memories are visible everywhere; `project` memories are visible
only to that project. A project sees global + its own memories, never another
project's. `defaultScope` decides where extraction lands.

Retrieval is BM25 (`k1 = 1.2`, `b = 0.75`) normalized to `[0, 1]`, blended with
recency (14-day half-life), confidence and a bounded recall counter boost.
`minScore` and `retrievalTopK` come from settings. `recall` records which entries
it injected, best-effort: a failed counter write never fails a turn. Injected text
is capped at 2,000 characters by dropping the weakest hits, never by truncating a
memory mid-sentence.

Extraction is deterministic heuristics over the user prompt and assistant text
(explicit `memory:`/`remember:` markers, first-person conventions, decisions,
gotchas, deploy/test facts). The provider text-generation service only exposes
fixed operations, so there is no generic "summarise this turn" call; heuristics
are local, free and testable, and err toward missing a fact rather than inventing
one. A model-backed extractor can replace `extractMemoryCandidates` without
changing the store or RPCs. Near-duplicates (token-set Jaccard ≥ 0.7) update the
existing entry instead of adding a second one.

Secrets are **rejected, not stored redacted**: manual adds, updates and extraction
candidates all run through `redactSecrets`; a credential-shaped memory fails with
`CodeItLabServiceError` so the user learns nothing was saved.

`MemoryService` is the RPC-facing tag (`list/search/add/update/remove/stats/recall`).
`MemoryExtractionService` and `MemoryTransferService` (export/import JSON) are
local tags, composed by `memoryLayer` with a single shared `MemoryStore`.

## REA

REA (`rea-agents`) is always on:

- `<stateDir>/codeitlab/mcp/rea.json` — a `NexusMcpServer` (`id: codeitlab-rea`,
  `sources: ["codeitlab","rea"]`) written by `ensureInstalled`. Nexus ingests every
  `*.json` in that directory, so registration reaches the catalog without an
  import cycle.
- `<stateDir>/codeitlab/skills/rea/SKILL.md` — the upstream MIT skill copied
  verbatim when a local installation is discoverable (workspace `node_modules`,
  Homebrew/global npm prefixes, `~/.npm/_npx` cache, or
  `CODEITLAB_REA_SKILL_SOURCE`), otherwise a bundled fallback with the same
  working rules. `source.json` records where it came from.

Verified CLI facts that the wiring depends on:

| Command                          | Meaning                                        |
| -------------------------------- | ---------------------------------------------- |
| `npx -y rea-agents@6.7.0 --mcp`  | starts the stdio MCP server                    |
| `rea mcp add` / `rea mcp doctor` | register/validate a client; **not** the server |
| `rea doctor --format json`       | environment/skill/client health                |
| `rea mcp doctor --format json`   | server startup, protocol, tool inventory       |
| `rea capabilities --format json` | providers, groups, side effects                |

`reaServerArgs` strips a trailing `mcp`/`--mcp` from stored settings and appends
the verified `--mcp` form, so an older default cannot regress into printing help.

`ReaService.status` runs the probes through the server's `ProcessRunner` (bounded
output, 30s timeout), parses JSON defensively, caches for 60s, and always reports
the real gaps: missing analysis engines and missing client registrations stay
visible as failed health checks instead of being smoothed over. `capabilities`
falls back to a static list when the CLI is unreachable.

The always-on instruction block (`reaAutoActivationBlock`) tells agents to reach
for REA on shipped artifacts without being asked, quote evidence ids, disclose
side effects, and report missing engines rather than installing anything.

## Policy (permissive profile)

`uncensored` in settings selects the `permissive` instruction profile. It changes
only the instructions CodeItLab itself adds; it cannot touch an upstream
provider's safety training, system prompt or platform moderation, and the
`limitations` array says so in plain language.

Provider support is honest about the channel:

| Driver                                       | Mechanism                                                        |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `codex`                                      | developer instructions (`appContext`)                            |
| `claudeAgent`, `opencode`, `pi`, `cursor`    | turn-message prefix (provider's own system prompt still applies) |
| `grok`, `muse`, `antigravity`, `acpRegistry` | turn-message prefix                                              |
| unknown                                      | turn-message prefix                                              |

Profile changes always append to `<stateDir>/codeitlab/policy/audit.jsonl`;
per-turn applications are audited only when `auditTrail` is on and the call names
a provider instance (panel reads without an instance are not applications and do
not spam the trail). Audit writes never fail a turn.

## Routing

Modes: `manual` (respect `providerOrder`), `auto` (score candidates), `omniroute`
(prefer the gateway's virtual models, fall back to scoring). CodeItLab defaults to
`auto` with `enforcement: "prefer"`: a turn is classified and routed only while the
session selection is the Auto router sentinel (an untouched thread still sitting on
its provider's default model is presented as Auto router too, so the picker and the
model that runs always agree). A concrete model the user picked is never replaced
under `prefer`; `force` is the explicit opt-in that overrides even a pick. Stock CodeItLab
Code defaults to `manual`; the CodeItLab schema is the only place that changes this.

Task classification is deterministic and explainable: image attachment or visual
wording → `vision`; explicit cheap/budget wording → `cheap`; code fences, coding
verbs, source paths or language names → `coding`; reasoning verbs/math → `reasoning`;
quick/lookup/short prompts → `fast`; otherwise `chat`. Every decision reports the
signals that fired.

Candidates come from the live provider registry: availability (enabled, installed,
not error/disabled, authenticated), remaining quota from usage-limit windows,
and name-based smartness/speed tiers. Score is a normalized weighted sum of
`quota`, `smartness` and `speed` (defaults `0.35 / 0.40 / 0.25`); available
candidates always outrank unavailable ones, ties break by `providerOrder`, then
instance id, then model. The decision includes every candidate plus a
human-readable reason, and is appended to
`<stateDir>/codeitlab/routing/history.jsonl` when `recordHistory` is on.

### Quota health (30-minute probe)

Routing decisions trust the last health snapshot. A background probe runs ~10 s
after boot and then every `codeitlab.routing.healthCheckMinutes` (default 30,
clamped to 5–1440, `0` disables the schedule; the Check now button still works).
Each probe calls `instance.snapshot.refresh` with a 20 s timeout, measures the
round trip, and records one row per instance in
`<stateDir>/codeitlab/routing/health.json` and the in-memory cache:

| status            | meaning                                                                  | routable |
| ----------------- | ------------------------------------------------------------------------ | -------- |
| `ok`              | enabled, installed, authenticated, quota left                            | yes      |
| `degraded`        | same, but under 10% of the quota window remains                          | yes      |
| `quota-exhausted` | the largest usage window is at 100%                                      | no       |
| `unauthenticated` | signed out                                                               | no       |
| `missing`         | CLI binary not installed                                                 | no       |
| `error`           | probe failed/timed out, provider error, or `availability: "unavailable"` | no       |
| `disabled`        | instance or provider disabled                                            | no       |

`decide` reads the cache (never blocks on a probe), marks non-routable rows
`available: false`, and uses the cached `quota` instead of the snapshot's. A
provider that fails a check therefore drops out of the next turn's candidates
until a later probe succeeds.

`routePerTask` (default on) picks the model inside each provider that fits the
classified task: the fastest tier for `fast`/`cheap`, the smartest for
`coding`/`reasoning`, capped at four seed models per provider
(`seedModelsForTask`) so a gateway with thousands of models cannot flood the
candidate list. Off falls back to each provider's default model. The candidate
list and the decision reason carry the per-model tiers, so the UI can explain
why `claude-haiku` beat `claude-opus-5.5` on a `tldr` turn.

OmniRoute is an OpenAI-compatible gateway. Discovery is `GET {baseUrl}/v1/models`
with an optional bearer token from `apiKeyEnv`, cached for 5 minutes, best-effort:
an unreachable gateway removes OmniRoute candidates and never fails routing. When
discovery fails, the configured `virtualModels` are still usable, so
`mode: "omniroute"` works offline.

### Enforcement (OmniRoute actually switches provider/model)

`codeitlab.routing.enforcement` controls whether the decision is applied to the
turn or only described in the prompt. Default `"prefer"`; nothing happens while
`mode` is the stock `"manual"`, so existing users are unaffected.

| enforcement | current model                          | /compact | provider unavailable / model missing | result                                                                 |
| ----------- | -------------------------------------- | -------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `off`       | any                                    | any      | –                                    | no switch; decision recorded with `enforced: false, skipReason: "off"` |
| `prefer`    | any concrete model (default or picked) | no       | –                                    | keep it — a session runs the model its picker shows                    |
| `prefer`    | Auto router sentinel                   | no       | –                                    | switch to routed instance + model                                      |
| `force`     | any, including a picked model          | no       | –                                    | switch                                                                 |
| any         | any                                    | yes      | –                                    | keep, `skipReason: "compact"`                                          |
| any         | any                                    | –        | yes                                  | keep, `skipReason: "provider_unavailable"` / `"model_unavailable"`     |
| any         | already routed                         | –        | –                                    | keep, `skipReason: "already_selected"`                                 |

The enforcement point is `Orchestrator.dispatchMessage`, where a new run is
created: `resolveEnforcedModelSelection` (routing/enforcedRoute.ts) calls the
routing service through `activeRoutingService` (the same late-binding pattern as
turn injection, because orchestration is built before the CodeItLab layer) and
replaces `modelSelection` **before** the provider switch is planned and before
`thread.model-selection-updated` / `run.created` / the `provider-turn.start`
effect are emitted. This covers every dispatch mode that starts a new run
(`start_immediately`, `defer_start`, `queue_after_active`); steering or
restarting the active turn keeps that session's selection. Queued runs therefore
already carry the enforced selection when they later start, and
`startNextQueuedRun` does not decide again (one decision per turn). A
cross-provider route restarts or resumes exactly like a user-initiated model
switch, and the emitted `thread.model-selection-updated` /
`thread.provider-switched` events plus the run's `modelSelection` report the
provider/model that actually runs. `resolveEnforcedModelSelection` returns
`undefined` for any concrete selection under `prefer` (before it even calls
`decide`), so the router cannot record a suggestion that contradicts the picker.
`/compact` turns never switch. Routing failures are logged and the user's
selection is kept.

### Context handoff when the routed model fails

A failed turn is never silently retried on another model mid-turn. The failure is
classified (`RunExecutionService`), provider failures are recorded in the
process-local `providerFailures` map for `providerFailureCooldownMinutes`, and the
failed run stays in the thread with its messages, tool output and error item.

The next Auto router turn excludes the cooling provider (`resolveEnforcedModelSelection`
→ `applyFallback`) and routes to the configured backup (or the first healthy
provider). Because the provider instance changed, `Orchestrator.dispatchMessage`
creates a `provider_handoff` context transfer (`ContextHandoffServiceV2`) before
the run: `delta_since_target_last_seen` for a provider thread that has seen earlier
runs, `full_thread_summary` when the target has no native thread yet. The handoff
covers every handoff-source run since the target last saw the thread — including
the failed run — and `ContextHandoffDelivery` injects the summary/coverage into the
new turn, with a "Provider handoff" turn item in the timeline. Same-provider model
changes continue the same native thread (context preserved by the provider
session); a provider that requires a new thread per model gets a full summary
instead. A concrete pick under `prefer` keeps its model after a failure (it is the
user's decision), so a broken explicit model fails again rather than switching
silently — pick Auto router for fallback behaviour.

> Verified live (2026-10-22, commit `fe27e8e3`): a real server run from source
> (throwaway `CIL_HOME`) enforced `static-best-coding` → `claude-fable-5-1`
> under `force` (log line + one `history.jsonl` entry with `enforced:true` +
> persisted `thread.model-selection-updated` + the model string handed to the
> provider process), kept a pinned model under `prefer`
> (`skipReason:"pinned"`, no switch, turn completed), and did not route at all
> under `manual` (no log, no history entry). Only one provider (`claudeAgent`)
> is authenticated in that environment, so the observed switch is same-instance
> model switching, not a cross-provider one. Details and excerpts:
> `release/verification/routing-e2e.md`.
>
> The placement is guarded automatically by
> `apps/server/src/codeitlab/routing/enforcementPlacement.test.ts` (real
> orchestrator + effect worker + routing service, in-process fake provider): a
> new `start_immediately` message adopts the routed model, exactly one history
> entry is recorded, and a `steer_active` dispatch keeps the selection it asked
> for without a second decision. Moving the resolution back into
> `startNextQueuedRun` makes that test fail, which is the regression it exists
> for. `ProviderReplayHarness` gained an optional `settings` override (default
> unchanged) to make the routing settings reachable from a test.

Every enforced switch logs one structured line at that decision point:

```text
CodeItLab route enforced
  decisionId, taskClass, enforcement,
  fromInstanceId, fromModel, toInstanceId, toModel
```

`RoutingDecideInput.currentModelSelection` triggers the enforcement verdict and
`RoutingDecideInput.recordHistory` (default true) lets advisory callers skip the
history write, so one turn produces one authoritative record with
`RoutingDecision.enforced` and an optional `skipReason`. Both fields are
optional, so existing history lines still decode.

### Provider fallback: a backup harness when one fails

A provider that fails a turn (auth, quota, HTTP 4xx/5xx, transport) is not
retried by the router; instead CodeItLab remembers the failure for
`providerFailureCooldownMinutes` (default 10) and the next auto-routed turns
skip that provider:

- `fallbackOnProviderFailure` (default `true`) enables the behaviour;
  `false` restores the old "route to whatever the health snapshot likes"
  behaviour.
- `fallbackInstanceId` names the backup provider instance (empty = first
  enabled, healthy instance in preference order); `fallbackModel` pins its
  model (empty = the backup provider's default/seed model).
- `resolveEnforcedModelSelection` never returns the cooling-down/unhealthy
  provider: it resolves the backup selection and logs
  `CodeItLab fallback route resolved: <from> failed, using <to>/<model>.`
  (`reason: "provider_failure"`). When every provider is cooling down it still
  honours the configured backup as a last resort
  (`reason: "all_providers_cooling"`).
- The recorded decision is annotated through `RoutingService.recordFallback`
  with ` Fell back to <instance>/<model> because <instance> failed.` so the
  history explains the switch and the routing page shows its `fallback` badge
  (`data-route-fallback`). When the router could not record any decision for
  the turn (every provider cooling, `decide` threw), the same call appends a
  synthetic decision instead: `id: route_fallback_<uuid>`,
  `taskClass: "coding"`, `providerKind: ""`, `enforced: true`, reason
  `Fell back to <instance>/<model> because <instance> failed.` — the badge and
  the audit trail work in both cases.
- The UI shows the four settings on the Routing page and marks such decisions
  with a `fallback` badge (`data-route-fallback`).
- Failures are recorded from the orchestration run-failure path with the
  provider failure class; `validation_error` is not a provider failure and is
  ignored.

### Speed probe: a real `hi` per model

Provider snapshots say whether a CLI is installed and signed in; they do not say
how fast a model answers. `codeitlab.routing.speedProbe` (default `true`) adds a
real measurement: on every health check, for each provider that is `ok` or
`degraded`, CodeItLab sends one tiny text-generation turn (`"hi"`) to the
candidate models — bounded by `speedProbeModelsPerProvider` (default 3, clamp
1–10) and chosen from the router's own seed models (smartest/fastest/default,
legacy skipped). The wall-clock time of the whole one-word round trip is the
measured latency.

- `speedScoreFromLatency`: ≤800 ms → speed score 1.0, ≥8000 ms → 0.1, linear in
  between. `buildSeeds` uses the measured score for a model whose probe
  succeeded and keeps the name-tier heuristic for everything else.
- Failure handling: each model is tried once, then retried immediately; only
  after both attempts fail is it recorded as `ok: false` with the error, and it
  is retried again on the next scheduled check (`retrying` in the entry).
- Progress: `health.json` carries an aggregate `speedProbe`
  `{status: checking|done|partial|error|off, startedAt, finishedAt?, checked,
total}` plus per-provider `speeds` (fastest first) and `speedProbe`. Each
  finished model is committed immediately, so the UI can show live progress and
  a probe cut off by the 90 s cap is finalized as `partial`/`error`, never left
  spinning.
- UI: the routing page shows **"Checking all harness and models…"** with
  `checked/total` on first use (and whenever a check runs), then a compact
  summary ("Measured N models in M providers · fastest: CodeItLab Hermes ·
  1.2 s") and per-provider measured rows (`data-speed-model`,
  `data-speed-latency-ms`, `data-speed-ok`). `speedProbe: false` renders the
  probe as `off` and makes zero model calls.
- Log line per probe: `CodeItLab speed probe {checked, total, failed, fastest}`.
- Which providers can be measured: the probe uses the provider instance's
  `textGeneration.generateThreadTitle`. CLI-backed providers (Claude, Codex,
  Grok, …) already implemented it; ACP Registry instances (Hermes, Qoder CLI,
  …) now implement it too via a disposable `session/new` in
  `packages/provider-acp-registry/src/server/textGeneration.ts` (real `hi`
  turn, 20 s cap, model from the selection, elicitations declined, session and
  process disposed in every path). Providers that cannot run a text-generation
  turn keep the name-tier heuristic and report the probe error.

### Deep model scan: measure every advertised model once

The light probe measures a three-model shortlist. That is enough for CLI
harnesses that advertise a dozen models, but not for a gateway like Hermes with
~2,200 custom models: the router used to score the long tail with name-based
heuristics only, so it could pick a model that does not exist upstream or never
answers. The deep scan closes that gap.

- **Every model, once.** `deepScanModelSlugs` takes every non-legacy,
  de-duplicated model a provider advertises (hard cap `DEEP_SCAN_MAX_MODELS =
4,096`) and `probeInstanceModelSpeed` sends one `"hi"` turn per model with
  `retry: false` and a per-model timeout. It runs in the background, so a
  catalog of thousands of models does not block the first turn.
- **Settings** (`packages/codeitlab/src/settings.ts`, `codeitlab.routing`):
  `deepScan` (default `true`), `deepScanConcurrency` (default 8, clamp 1–16),
  `deepScanTimeoutSeconds` (default 12, clamp 5–60). The routing page exposes
  `[data-codeitlab-setting="deepScan"|"deepScanConcurrency"|"deepScanTimeoutSeconds"]`.
- **When it runs**: on the first health check after boot, when the provider's
  model fingerprint changes (`deepScanFingerprint` = count + FNV-1a over the
  sorted slugs), or when the last deep scan is older than
  `DEEP_SCAN_REFRESH_MS` (6 h). `checkHealth` (manual "Check now" and the
  first-run wizard, via the `codeitlab.routing.checkHealth` RPC) runs the light
  probe and then calls `scanModels`, which forces a deep scan and returns the
  `checking` snapshot immediately. The scheduled light probe is skipped while a
  deep scan runs.
- **Progress**: `health.json` keeps an aggregate `speedProbe` with
  `mode: "deep"`, `checked`, `total`, `okCount`, `failedCount` and per-provider
  `speedProbe {mode: "deep", modelCount, fingerprint, okCount, failedCount}`.
  Progress is persisted every 25 completions; a finished scan is `done` (or
  `partial` when the cap/timeout cut it short).
- **Routing uses only measured models.** Once any model for a provider has been
  measured, `buildSeeds` ranks the successful ones with `rankTestedModels`:
  `fast`/`cheap` → lowest measured latency, `vision` → vision-capable names
  first then smartness, `coding`/`reasoning` → smartness then speed then
  latency, `chat` → 0.6·smartness + 0.4·speed. Failed and untested models are
  never candidates after the scan, and a provider whose scan finished with zero
  answering models is marked unavailable even when its login/quota look fine.
  While the scan is still warming up (no measurement yet) the heuristic
  shortlist keeps the first turn routable.
- **Log lines**: `CodeItLab deep scan started`, `CodeItLab deep scan provider
{providerInstanceId, checked, ok, failed}` and `CodeItLab deep scan complete
{checked, total, ok, failed, providers}`.
- **UI**: while scanning, the routing page shows
  `[data-codeitlab-speed-probe="deep"]` with
  `data-speed-probe-checked|total|ok|failed|providers`; when finished,
  `[data-codeitlab-speed-probe="deep-done"]` with the same counters, and each
  health row carries `data-provider-scan-mode="deep"` plus a
  `data-provider-scan-summary` line (`deep scan · 1,900/2,210 available`).
- **Scope**: the scan measures what the provider actually advertises through
  its ACP session. A gateway whose extra models are configured but not active
  (for example Hermes with a custom provider that is not the current
  `model.provider`) is not advertised by Hermes and therefore cannot be
  measured — point the provider at the gateway and the scan picks the models
  up on the next check.
- **Cost**: one tiny turn per advertised model. A 2,200-model gateway at
  concurrency 8 and a 12 s timeout takes roughly 55 minutes worst case and
  sends 2,200 `"hi"` turns; the scan is incremental, interruptible at layer
  shutdown, and refreshed only when the model list changes or after 6 h.

### Auto router selection (opt-in)

Routing is not only a background policy: the user can pick it as a model. The
model picker (composer only — settings pickers never offer it) shows a pinned
**Auto router** row: _"Best model per task · all enabled apps"_. Selecting it
stores a sentinel `ModelSelection` — `instanceId: "codeitlab_auto"`,
`model: "auto"` (`AUTO_ROUTE_SELECTION` / `isAutoRouteSelection` in
`packages/contracts/src/modelSelection.ts`) — as the thread's model selection.
The composer trigger shows a Sparkles icon + "Auto router"; every other label
(sidebar, context meter, command palette, subagent bar) renders the same label
through `apps/web/src/codeitlab/autoRouterLabel.ts`.

The sentinel never reaches a provider session:

- `Orchestrator.dispatchMessage` calls `resolveEnforcedModelSelection` for every
  new run (as before). For a sentinel current selection the resolver **always**
  routes — it ignores `routing.mode: "manual"`, `routing.enforcement: "off"`, and
  even missing CodeItLab settings — and it never returns the sentinel. A returned
  decision wins even when the verdict skipped it (e.g. `/compact`), unless the
  verdict says the routed provider/model is unavailable; then the catalog
  fallback (first `available` provider, `defaultModel ?? models[0]`) is used and
  a `CodeItLab auto router fell back to …` warning is logged.
- The run gets the concrete provider/model; the **thread keeps the sentinel**, so
  the next turn routes again. Both selection-emission sites in
  `Orchestrator.ts` (new-run creation and active steer) only preserve the
  sentinel when the _requested_ selection was the sentinel — picking a concrete
  model replaces it and turns Auto router off.
- Steer/restart and promote-to-steer on an Auto router thread steer with the
  active run's concrete selection (`preserveAutoRouterSelection`), so a steer
  never forces a provider switch or an adapter lookup for `codeitlab_auto`.
- One routing decision per turn, same history entry and `enforced`/`skipReason`
  fields as the enforcement path above. With the sentinel the `enforced` flag
  describes the verdict, not whether the turn ran — the turn always runs on the
  resolved selection.

> Verified live (2026-10-23): packaged build, isolated `CIL_HOME` seeded with
> the user's four instances (`hermes` enabled, `claudeAgent` enabled, `codex`
> disabled, `acpRegistry_qoder_cli` enabled). See `release/verification/record.md`
> "Round 13 — Auto router" and `release/verification/autorouter-e2e.md`.

## One block per turn

`CodeItLabContextService.buildTurnContext` composes, in order: policy instructions,
recalled memory, routing decision, REA activation, Nexus catalog summary (when the
Nexus service is present). The result is one `<codeitlab_context>…</codeitlab_context>`
block capped at 6,000 characters, trimmed from the tail so policy and memory stay
whole. Contributors degrade to "absent" on failure; only a settings read failure
fails the service, and the turn hook treats any failure as "no context".

Delivery is hybrid, decided by the transport hook: Codex receives the block as
`appContext` developer instructions; every other provider gets it as a prefix on
the turn message. That is why the block must be self-contained and why the policy
matrix discloses the weaker channel for non-Codex drivers.

## Service wiring

| Layer                                                         | Requirements                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `memoryLayer` (MemoryService + extraction + transfer + store) | `ServerConfig`, `ServerSettingsService`, `FileSystem`, `Path`, `Crypto`                                              |
| `ReaService.layer`                                            | `ServerConfig`, `ServerSettingsService`, `ProcessRunner`                                                             |
| `PolicyService.layer`                                         | `ServerConfig`, `ServerSettingsService`, `ProviderInstanceRegistry`, `FileSystem`, `Path`, `Crypto`                  |
| `RoutingService.layer`                                        | `ServerConfig`, `ServerSettingsService`, `ProviderInstanceRegistry`, `FileSystem`, `Path`, `Crypto`, `HttpClient`    |
| `CodeItLabContextService.layer`                               | `ServerSettingsService`, `MemoryService`, `RoutingService`, `PolicyService`; `NexusService` is optional at call time |

Use `memoryLayer` rather than `MemoryService.layer` when composing the server:
the plain service layer leaves `MemoryStore` unprovided.

## RPC mapping

| WS method                       | Service call                                             |
| ------------------------------- | -------------------------------------------------------- |
| `codeitlab.memory.list`         | `MemoryService.list(input)`                              |
| `codeitlab.memory.search`       | `MemoryService.search(input)`                            |
| `codeitlab.memory.add`          | `MemoryService.add(input)`                               |
| `codeitlab.memory.update`       | `MemoryService.update(id, patch)`                        |
| `codeitlab.memory.delete`       | `MemoryService.remove(id)` → `{}`                        |
| `codeitlab.memory.stats`        | `MemoryService.stats`                                    |
| `codeitlab.routing.catalog`     | `RoutingService.catalog`                                 |
| `codeitlab.routing.decide`      | `RoutingService.decide(input)`                           |
| `codeitlab.routing.history`     | `RoutingService.history(limit)`                          |
| `codeitlab.routing.health`      | `RoutingService.health` (cached; probes once when empty) |
| `codeitlab.routing.checkHealth` | `RoutingService.checkHealth` (probes now)                |
| `codeitlab.policy.effective`    | `PolicyService.effective(input)`                         |
| `codeitlab.policy.setProfile`   | `PolicyService.setProfile(profile)` → `{}`               |
| `codeitlab.rea.status`          | `ReaService.status`                                      |
| `codeitlab.rea.install`         | `ReaService.ensureInstalled`                             |

`ReaService.capabilities` and `PolicyService.audit` exist on the services but have
no RPC method yet; add them when the settings panel needs them.

## Verification

```bash
vp test run apps/server/src/codeitlab/memory/memory.test.ts \
  apps/server/src/codeitlab/memory/memoryStore.test.ts \
  apps/server/src/codeitlab/memory/memoryService.test.ts \
  apps/server/src/codeitlab/rea/rea.test.ts \
  apps/server/src/codeitlab/policy/policy.test.ts \
  apps/server/src/codeitlab/routing/routing.test.ts \
  apps/server/src/codeitlab/routing/health.test.ts \
  apps/server/src/codeitlab/context.test.ts
```

Covers: redaction, extraction and near-duplicates, BM25 ranking and scoping,
JSONL persistence and malformed-line recovery, service CRUD/recall/stats,
secret rejection, export/import, REA CLI parsing plus registration and skill
seeding against a fake CLI, policy resolution and audit, classification and
scoring, quota-health classification and seeding, health persistence and
demotion of failing/exhausted providers, per-task model selection, OmniRoute
parsing, and context composition with and without Nexus.

A live probe against the real CLI (not committed as a test) produced
`installed: true`, `version: 6.7.0`, `mcpServerId: codeitlab-rea`,
`mcpArgs: ["-y","rea-agents@6.7.0","--mcp"]`, `mcp:inventory 207 tools`,
`mcp:inventory:prompts 6`, and seeded the upstream skill at
`<stateDir>/codeitlab/skills/rea/SKILL.md`.

## Fast, task-correct decisions

- **Classification is bilingual.** The user writes Greek and Greeklish as often
  as English. JavaScript's `\b` only knows ASCII word characters, so the Greek
  rules in `classify.ts` use `(?<![\p{L}])` / `(?![\p{L}])` lookarounds; plain
  `\b` silently never matches Greek text. Greek coding verbs
  (`γράψε`, `φτιάξε`, `διόρθωσε`, `συνάρτηση`, `κώδικας`…), reasoning verbs
  (`γιατί`, `ανάλυσε`, `σύγκρινε`…), quick/lookup, cheap, vision, plus
  Greeklish variants all map to the same task classes as English.
- **The task class shifts the weights.** `weightsForTask(taskClass, userWeights)`
  multiplies the user's quota/smartness/speed weights per class (fast → speed
  ×2.5 and smartness ×0.35; cheap → quota ×2; coding/reasoning → smartness
  ×1.5; vision → smartness ×1.3), then `scoreCandidate` normalises. Measured
  latency saturates at 800 ms, so without this a fast turn keeps picking the
  smarter model for a difference a human cannot feel. The decision reason shows
  the effective weights, so the UI explains the choice.
- **Measured latency feeds the speed score.** `buildSeeds` replaces the
  name-tier speed with `speedScoreFromLatency(measuredLatencyMs)` for models the
  deep scan or light probe measured; untested models keep the tier.
- **Decisions are cheap.** `decide` is in-memory only (settings Ref, registry
  snapshot, health Ref) except for one history append. `history.jsonl` is
  append-only: one line per decision, compacted back to the 200-entry bound once
  the file grows past it, instead of rewriting every decision entry (which grew
  with the candidate list after the deep scan). A scale test scans 2,000 models
  and asserts both a coding and a fast decision stay under 250 ms.
- **Every decision is timed.** The server logs
  `CodeItLab routing decision {durationMs, taskClass, providerInstanceId, model,
candidates, enforced}`; packaged E2E reads these lines to prove latency.

## Every reply names the model that served it

- Auto router keeps the sentinel (`codeitlab_auto` / `auto`) as the thread
  selection, so the composer label alone never says which model actually ran.
  Each assistant message now renders a small chip with the concrete
  provider/model of its run (`[data-message-model]`,
  `[data-message-model-provider]`, e.g. `CodeItLab Hermes · nemotron-3.5-bolt`),
  sourced from the run projection (`runs[].modelSelection`), which the
  orchestrator fills with the enforced selection before the run is created.
- This is per reply, not per thread: a conversation that switches models (or
  whose Auto router picks a different model per task) shows the real model on
  every message. Replies without a run (synthetic/system) show no chip.
- Mobile does not render the chip yet: its thread feed has no run projection.

## Known limits

- Extraction is heuristic until a generic model-backed text operation exists.
- Smartness/speed tiers are model-name heuristics for models without a measured
  latency; measured latency (deep scan/light probe) overrides the speed tier,
  but smartness is still name-based until a benchmark exists.
- A health check probes each provider's snapshot; it does not send a test prompt,
  so a provider can be `ok` and still fail a specific model.
- The scheduler interval is read each cycle, so changing it applies after the
  current sleep; there is no immediate re-probe on save.
- Vision routing only classifies the task; it does not verify model vision support.
- The permissive profile is instruction-only by design; it cannot and does not
  bypass provider policy, and the UI must keep showing the limitations.

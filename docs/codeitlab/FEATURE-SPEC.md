# codeitlab feature specification

> **Design document, not a repo map.** The paths below are the layout this
> design proposed, and some never existed under these names. For what the repo
> actually contains today, read [ARCHITECTURE.md](./ARCHITECTURE.md) and
> [STATUS.md](./STATUS.md).
> Implementation-ready spec for the codeitlab features. The shared contracts already exist in
> `packages/codeitlab` (`@codeitlab/core`, re-exported from `packages/contracts/src/codeitlab.ts`), so
> this spec is written **against the real schemas and service tags**, not a proposal:

| Module                     | Key exports                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@codeitlab/core/settings` | `CodeItLabSettings` (under `ServerSettings.codeitlab`), `DEFAULT_CODEITLAB_SETTINGS`, `CodeItLabEffectsSettings`, `CodeItLabNexusSettings`, `CodeItLabMemorySettings`, `CodeItLabRoutingSettings`, `CodeItLabPolicySettings`, `CodeItLabReaSettings` |
| `@codeitlab/core/nexus`    | `NexusCatalog`, `NexusSkill`, `NexusMcpServer`, `NexusSession`, `NexusProviderSummary`, `NexusSkillSource`, `NexusMcpTransport`                                                                                                                      |
| `@codeitlab/core/memory`   | `MemoryEntry`, `MemoryKind`, `MemoryScope`, `MemorySearchInput`, `MemorySearchHit`, `MemoryRecall`, `MemoryStats`                                                                                                                                    |
| `@codeitlab/core/routing`  | `TaskClass`, `RoutingCandidate`, `RoutingDecision`, `RoutingDecideInput`, `RoutingCatalog`                                                                                                                                                           |
| `@codeitlab/core/policy`   | `PolicyProfile` (`standard` \| `permissive`), `EffectivePolicy`, `PolicyAuditEntry`                                                                                                                                                                  |
| `@codeitlab/core/rea`      | `ReaStatus`, `ReaHealthCheck`, `ReaCapability`                                                                                                                                                                                                       |
| `@codeitlab/core/services` | Effect service tags: `NexusService`, `MemoryService`, `RoutingService`, `PolicyService`, `ReaService`, `CodeItLabContextService` (+ `CodeItLabTurnContext`, `CodeItLabTurnContextInput`)                                                             |

Cross-cutting rules:

- **Server owns behavior.** Each feature implements one Effect service tag from
  `@codeitlab/core/services`; `ws.ts`, HTTP routes, and MCP toolkits are thin adapters that decode
  input and call one method. Clients never implement policy.
- **One settings key.** Everything lives under `ServerSettings.codeitlab`; the panel sends the whole
  block (patch is a whole-struct replacement). No per-feature settings RPC.
- **Events over polling.** Live UI updates use application events: `nexus.catalog.changed`,
  `memory.entry.written`, `routing.decision.recorded`, `policy.changed`, `rea.status.changed`,
  `ecosystem.health.changed`.
- **No new cloud dependency.** SQLite, local processes, local files. OmniRoute is the only network
  hop and it is user-configured.
- **Read-only toward harnesses.** Nexus/memory/REA never write another agent's config or sessions.
- **Honest limits.** `EffectivePolicy.limitations` and `NexusCatalog.warnings` are user-visible; a
  feature that cannot apply says so instead of pretending.

---

## 1. Nexus — unified ACP catalog

### Goal

One merged catalog of skills, sessions, and MCP servers across every configured harness, with a
cross-provider session browser, MCP dedupe/merge, and a skills union — so the user stops caring
which harness owns what. Implementation: `NexusService.catalog` / `.refresh`, backed by the
`@codeitlab/core/nexus` schemas.

Non-goals: resuming a foreign provider session in place (session IDs are not portable); writing to
another harness's config; inventing skills for agents that expose none (ACP does not standardize
skills — that is a hard limit, surfaced as a warning).

### Data model (existing)

`NexusCatalog = { generatedAt, providers: NexusProviderSummary[], skills: NexusSkill[],
mcpServers: NexusMcpServer[], sessions: NexusSession[], warnings: string[] }`

- `NexusSkill`: `id` (`<source>:<name>`), `name`, `description`, `source`
  (`hermes|claude|codex|cursor|opencode|acp-registry|codeitlab|filesystem`), `providerInstanceId?`,
  `path?`, `alsoAvailableIn[]`.
- `NexusMcpServer`: `id` (dedupe fingerprint over command+args+env keys), `name`, `transport`
  (`stdio|http|sse|acp`), `command?`, `args[]`, `url?`, `envKeys[]` (**names only**), `sources[]`,
  `enabled`, `tools[]` (when probed).
- `NexusSession`: `id`, `providerInstanceId`, `providerKind`, `title`, `updatedAt`, `cwd?`,
  `messageCount?`, `threadId?` (set once imported), `remote`.
- `NexusProviderSummary`: per-instance counts + `available` + `detail`.

Contract additions needed (small): `NexusSession.format` (`claude-jsonl|codex-rollout|dsh-v4-zstd|
hermes-jsonl|acp|unknown`) and `NexusSession.importable` so the UI can disable import honestly;
`NexusCatalog.staleSources` for partial refreshes. Both are additive with decoding defaults.

### Server service boundary

`apps/server/src/nexus/` implements `NexusService`:

| File                               | Responsibility                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NexusCatalogService.ts`           | builds/holds the catalog, TTLs, refresh queue; `catalog` and `refresh` effects                                                                                                                                                                                |
| `NexusSourceRegistry.ts`           | maps enabled provider instances → source adapters                                                                                                                                                                                                             |
| `sources/AcpProbeSource.ts`        | `probeAcpRegistryConfiguration` + `listAcpRegistrySessions` (portable ACP path)                                                                                                                                                                               |
| `sources/FilesystemSkillSource.ts` | one scanner over `.claude/skills`, `.codex/skills`, `.cursor/skills`, `.agents/skills`, `.grok/skills`, `.gemini/skills`, `.dsh/skills`, `~/.hermes/skills`; reuses the frontmatter parsing from `ClaudeSkills.ts` and `provider-cursor/src/server/skills.ts` |
| `sources/NativeSessionSource.ts`   | Claude JSONL, Codex rollouts, DSH v4 zstd, Hermes JSONL — streamed, size/inode guarded                                                                                                                                                                        |
| `sources/McpConfigSource.ts`       | Hermes `config.yaml:mcp_servers`, Claude `~/.claude.json` + `.mcp.json`, Codex `config.toml`, OpenCode `mcp`, Gemini `settings.json`, Cursor `.cursor/mcp.json`, DSH Cordis profile, REA (registered MCP)                                                     |
| `NexusMerge.ts`                    | precedence, dedupe, `alsoAvailableIn`, conflict warnings                                                                                                                                                                                                      |
| `NexusImportService.ts`            | import a readable session into a thread (wraps `agentSessions.import`), sets `threadId`, idempotent                                                                                                                                                           |
| `NexusRefreshWorker.ts`            | debounced background refresh, per-source failure isolation                                                                                                                                                                                                    |

Precedence: project > user > plugin > bundled; native harness > generic ACP; duplicates collapse
into one row with `alsoAvailableIn`. MCP conflicts (same name, different env/headers) become a
`warnings` entry, never a silent winner. Refresh: filesystem 5 min TTL (setting
`nexus.refreshIntervalMins`, default 15), ACP probes 15 min on success / never cached on failure,
watcher invalidation debounced ≥ 2 s. Auto-injection (`nexus.autoInject`, default true) adds one
compact line to turn instructions — counts only, not the catalog itself.

### Contract changes

- `WS_METHODS`: `codeitlab.nexus.getCatalog`, `codeitlab.nexus.refresh`,
  `codeitlab.nexus.importSession`, `codeitlab.nexus.setMcpEnabled`.
- Event `nexus.catalog.changed` (catalog version + changed source ids, never the whole catalog).
- Settings: already present (`enabled`, `includeSkills`, `includeSessions`, `includeMcp`,
  `autoInject`, `refreshIntervalMins`, `customAcpAgents[]` with `transport: local|ssh|tailscale`).

### UI surface

- `apps/web/src/routes/settings.nexus.tsx` → `components/nexus/NexusSettings.tsx`: source health,
  toggles, custom ACP agents (local/ssh/tailscale command instances), refresh.
- Command-palette entry "Nexus: browse catalog" → `components/nexus/NexusBrowser.tsx`: tabs
  Skills / Sessions / MCP, search, source filter chips, duplicate expander.
- Session rows: harness badge, project, title, age, message count, "Import to project" (disabled
  with reason when not importable), "Open folder".
- MCP rows: enable toggle, tool list, conflict warning, "applies to new sessions" note.
- Composer skill list (`providerSkillSearch.ts`) shows the union tagged by harness; skills
  unavailable for the current provider are disabled with the reason.

### Acceptance criteria

1. With ≥ 2 configured harnesses, the catalog returns skills from both; a skill present in two
   roots appears once with `alsoAvailableIn` listing both; editing one copy does not hide the other.
2. Sessions from Claude (`~/.claude/projects`), Codex (`~/.codex/sessions`), DSH
   (`~/.dsh/sessions`), and Hermes (`~/.hermes/sessions`) are listed with correct project/title/
   timestamps; corrupt/unreadable files are skipped and counted in `warnings`.
3. Importing a Claude session creates a thread with the same messages, sets `threadId`, and a second
   import is refused.
4. Identical MCP servers collapse by fingerprint; differing env keys produce a warning row; no
   provider config file is modified (assert by mtime/hash before/after).
5. `refresh` never blocks longer than 100 ms: a slow source returns the previous catalog plus
   `staleSources`/`warnings`.
6. No env/header value appears in any payload — `envKeys` only (test with a canary secret).
7. `autoInject` adds ≤ 200 tokens to a turn and is absent when Nexus is disabled.

### Test plan

- Unit: `NexusMerge.test.ts` (precedence, dedupe, conflicts), `FilesystemSkillSource.test.ts`
  (frontmatter variants incl. YAML 1.1 booleans, symlink loops, oversized files),
  `NativeSessionSource.test.ts` (one fixture per format, incl. a real DSH v4 zstd sample).
- Integration: `NexusCatalogService.test.ts` with a temp HOME containing two fake harness trees +
  testkit provider instances; assert catalog, stale sources, event emission.
- RPC: `apps/server/src/ws.test.ts` additions for the new methods and permissions.
- Browser: `NexusBrowser.browser.test.tsx` — filter, expand duplicates, import flow (mocked RPC).

---

## 2. Memory — persistent, local, inspectable

### Goal

A local fact store that makes the agent remember across threads: extract durable facts after a turn,
recall relevant ones before the next, scope per project and globally, and let the user inspect, edit,
forget, and export everything. Implementation: `MemoryService` from `@codeitlab/core/services`.

Non-goals: replacing provider-native memory (Claude/Codex have their own); storing secrets;
unbounded transcript storage (that is the event store).

### Data model (existing)

`MemoryEntry = { id, scope: "global"|"project", projectId, kind: "fact"|"preference"|"decision"|
"convention"|"gotcha"|"session-summary", text, source: "turn"|"manual"|"import"|"nexus",
createdAt, updatedAt, recalls, tags[], confidence }`

`MemorySearchInput = { query, projectId, limit, minScore }`;
`MemorySearchHit = { entry, score }`;
`MemoryRecall = { query, hits[], injectedText }`;
`MemoryStats = { total, global, project, byKind, lastExtractionAt }`.

Persistence: new SQLite migration in `apps/server/src/persistence/Migrations/` (number allocated by
build-eng): `memory_entries` (entry columns + `content_hash UNIQUE`), `memory_entries_fts` (FTS5 over
`text, tags`), `memory_recall_log` (entry id, thread id, at) for `recalls`/trust. Project scope is
`project_id = NULL` for global.

### Server service boundary

`apps/server/src/memory/` implements `MemoryService`:

| File                   | Responsibility                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemoryStore.ts`       | SQLite CRUD, FTS5 search (bm25 × confidence × recency), stats, remove, export                                                                               |
| `MemoryExtractor.ts`   | after a run settles: bounded transcript digest → configured small model with a strict JSON schema → validate → redact → dedupe by `content_hash` → `add()`  |
| `MemoryRecaller.ts`    | builds the query from the new user message + project + recent titles; `recall()` returns hits + rendered `injectedText` capped by `retrievalTopK`/token cap |
| `MemoryServiceLive.ts` | Effect layer implementing the tag; used by `CodeItLabContextService` and MCP tools                                                                          |
| `MemoryMigration.ts`   | schema creation/migration helpers                                                                                                                           |

Write path: post-settlement effect (after `RunFinalizationService` commits), never inside the
orchestrator transaction; cancellable; rate-limited (≤ 1 extraction per thread per 5 min); only when
`memory.autoExtract`. Read path: `CodeItLabContextService.buildTurnContext` calls
`MemoryService.recall` when `memory.autoRecall`, appends `injectedText` to `instructions` after
pinned/policy blocks, and returns `recall` for the UI. MCP tools: `memory_search`, `memory_write`,
`memory_forget` via a toolkit layer.

### Contract changes

- `WS_METHODS`: `codeitlab.memory.list`, `.search`, `.add`, `.update`, `.remove`, `.stats`,
  `.recall`.
- Event `memory.entry.written` / `memory.entry.removed` (id + scope only).
- Settings: present (`enabled`, `defaultScope`, `autoExtract`, `autoRecall`, `maxEntries`,
  `retrievalTopK`, `minScore`). Add `exportFormat` and `retentionDays` if retention ships.

### UI surface

- Settings → Memory (`routes/settings.memory.tsx`): enable, extraction/recall toggles, topK/minScore,
  storage size, export (JSON/Markdown), purge per project.
- Right-panel tab "Memory" (thread-scoped): facts used in this turn with the exact `injectedText`,
  search all, inline edit, forget, add manual fact; provenance (thread/turn), "recalled N times",
  confidence.
- Empty state: "extraction is local; turn it off any time".

### Acceptance criteria

1. A fact stated in thread A is recalled and injected in a later thread B of the same project; a
   fact from another project is not.
2. Global entries are available everywhere; project entries never leak across projects.
3. Extraction writes ≤ N entries per turn, dedupes identical text (`content_hash`), and rejects
   API-key-shaped strings (redaction test with a canary).
4. Every injected entry is visible with its rendered text and token cost; editing changes the next
   recall; removing removes it from recall immediately.
5. Fully local: the only network call is the configured model provider for extraction.
6. Disabling memory stops extraction and recall immediately; existing data stays readable.
7. Export/import round-trips without losing scopes, kinds, or timestamps.

### Test plan

- Unit: `MemoryStore.test.ts` (FTS ranking, dedupe, remove, export), `MemoryExtractor.test.ts`
  (schema validation, redaction, dedupe), `MemoryRecaller.test.ts` (scope isolation, token cap).
- Integration: two projects + three threads with a fake text-generation model; assert per-turn
  `injectedText` and no cross-project leakage.
- Migration test in the existing `persistence/Migrations` style (fresh + upgrade).
- Browser: Memory tab (search/edit/forget), settings toggles.

---

## 3. Boost — routing, context budgets, caching, parallel tools

### Goal

Make turns cheaper and faster without changing provider semantics: task-aware routing across
provider instances and models (`RoutingService`), explicit context budgets with pinned context and
compaction policy, prompt/context cache accounting, and parallel tool guidance where the harness
supports it.

Non-goals: silently switching model mid-turn; faking cache behavior; changing a provider's tool
semantics.

### Data model (existing + additions)

Existing: `RoutingCatalog`, `RoutingCandidate`, `RoutingDecision`, `RoutingDecideInput`, `TaskClass`
(`coding|reasoning|vision|chat|fast|cheap`), settings `routing.mode` (`manual|auto|omniroute`),
`routing.weights {quota, smartness, speed}`, `routing.providerOrder`, `allowFallback`,
`recordHistory`, `routing.omniRoute {enabled, baseUrl, apiKeyEnv, virtualModels[]}`.

Additions in `@codeitlab/core/routing` (or a new `context.ts`): `ContextBudget`, `CompactionPolicy`,
`PinnedContext`, `PromptCacheStat`, settings `routing.context {budgetPercent, pinnedTokenCap,
compaction: off|provider|summarize, thresholdPercent}`.

### Server service boundary

`apps/server/src/boost/`:

| File                        | Responsibility                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RoutingServiceLive.ts`     | implements `RoutingService`: `catalog` (instances + models + availability + quota + speed + smartness), `decide` (classify → filter unavailable → weighted score → reason), `history` |
| `TaskClassifier.ts`         | local heuristics first (attachments → vision, code fences/paths → coding, "why/design" → reasoning, one-liners → fast); small model only when ambiguous                               |
| `ContextBudgetService.ts`   | computes budget from the adapter's context window, reserves output, allocates pinned/memory/history/tool; called before each turn                                                     |
| `PinnedContextService.ts`   | CRUD for pinned context; stable ordering for cache-friendly prefixes                                                                                                                  |
| `CompactionOrchestrator.ts` | applies policy: provider-native `compactThread` → handoff summary → idle compaction                                                                                                   |
| `PromptCacheTracker.ts`     | records cache read/write tokens per provider/model (Claude `cache_control`, OpenAI automatic prefix, DeepSeek cache hits)                                                             |
| `ParallelToolPolicy.ts`     | sends parallel-tool guidance only to harnesses whose capability supports it; never reorders dependent tools                                                                           |
| `StreamingPolicy.ts`        | live vs buffered replay under `LiveStreamBudget`                                                                                                                                      |

`CodeItLabContextService.buildTurnContext` is the composition point: it calls
`RoutingService.decide` (when `routing.mode !== "manual"` and the thread has no pinned instance),
`MemoryService.recall`, `NexusService.catalog` (summary), and `PolicyService.effective`, then returns
one `CodeItLabTurnContext { instructions, recall?, decision?, policy, nexus? }` to the turn starter.
The decision is persisted on the turn so replay is honest.

### Contract changes

- `WS_METHODS`: `codeitlab.routing.getCatalog`, `.decide`, `.history` (preview only — the real
  decision happens server-side in the turn path), `codeitlab.context.getBudget`, `.pin`,
  `.unpin`, `codeitlab.cache.getStats`.
- Event `routing.decision.recorded`.
- Settings additions: `routing.context`, `routing.parallelToolCalls`, `routing.promptCache`.

### UI surface

- Composer model picker "Auto" row: predicted route (instance/model) + "why" popover (task class,
  weights, candidate table) with one-click pin for the thread.
- Right panel tab "Context": budget bar (pinned/memory/history/tool/output), pin/unpin, compaction
  policy, "compact now".
- Settings → Boost: weights sliders, per-task-class pins, cache stats, parallel-tools toggle.
- Assistant message chip "cache 82%" when a cache hit is reported.

### Acceptance criteria

1. `decide` never selects an unavailable/unauthorized instance or exhausted quota; if all candidates
   are exhausted the turn fails with the existing structured limit error + recovery option.
2. Same input → same decision (pure); weights change the decision predictably (property test).
3. Pinned context survives compaction and appears verbatim in the next turn's `instructions`; pinned
   tokens are counted in the budget.
4. Budget never exceeds context window − reserved output; exactly one compaction runs per threshold
   crossing.
5. Stable prefix ordering (policy → pinned → memory → history) produces cache reads on the second
   identical-prefix turn for Claude; stats reported per provider.
6. Parallel tool guidance only for capable harnesses; dependent calls stay serial.
7. Streaming degrades to buffered replay under `LiveStreamBudget` without dropping the final message.

### Test plan

- Unit: `TaskClassifier.test.ts` (table-driven corpus), `RoutingServiceLive.test.ts` (quota/
  smartness/speed matrices, pinned instance, fallback), `ContextBudgetService.test.ts` (window
  edges), `PinnedContextService.test.ts` (stable order).
- Integration: two fake provider instances + replay fixtures; assert route persisted, pinned context
  in `instructions`, compaction invoked once.
- Cache: adapter-level fixture asserting `cache_control` blocks only where supported.
- Browser: auto-route popover, context panel budget bar.

---

## 4. Policy / uncensored mode

### Goal

A visible, scoped toggle that replaces **codeitlab's own** conservative instruction scaffolding with
a permissive profile for users who want direct, unfiltered technical answers — while stating plainly
that it cannot change a provider's own policy, platform moderation, or the law. Implementation:
`PolicyService` + `PolicyProfile = "standard" | "permissive"`.

Non-goals: bypassing provider safety systems; enabling illegal content; hiding the mode; applying it
silently.

### Data model (existing)

`EffectivePolicy = { profile, appliedTo[], unsupported[{providerInstanceId, reason}],
instructionBlock, limitations[] }`; `PolicyAuditEntry = { id, at, threadId?, providerInstanceId,
profile }`; settings `policy.uncensored`, `policy.applyToProviders[]`, `policy.auditTrail`.

### Server service boundary

`apps/server/src/policy/` implements `PolicyService`:

| File                               | Responsibility                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PolicyServiceLive.ts`             | `effective` (resolve profile for the instance, render instruction block, report unsupported providers), `setProfile`, `audit`                                                       |
| `PermissiveInstructionRenderer.ts` | renders the permissive block: blunt, no moralizing, profanity allowed; explicit exclusions for illegal instructions, real-person harm, deployable malware                           |
| `PolicySupportMatrix.ts`           | per-driver capability: does the adapter accept instruction overrides? (Claude system prompt, Codex developer instructions, ACP instruction block, Cursor/Grok/OpenCode/Pi channels) |

Injection: `CodeItLabContextService` appends `instructionBlock` to `instructions`; the provider's own
system prompt is never touched. If a driver cannot accept the block, it appears in
`EffectivePolicy.unsupported` and the UI says "not applied for this provider" — no pretending.

### Contract changes

- `WS_METHODS`: `codeitlab.policy.getEffective`, `.setProfile`, `.getAudit`.
- Event `policy.changed`; audit entry on every profile change (when `auditTrail`).
- Settings: present.

### UI surface

- Settings → Policy: profile selector (standard/permissive), provider scope (all or selected),
  per-provider support table (green/amber/grey), audit log, "what this does / does not do" panel.
- Composer banner when permissive: `Permissive · 2 providers` with one-click revert.
- Thread header chip when a permissive turn ran.

### Acceptance criteria

1. Default `standard`; switching to `permissive` requires an explicit confirm and writes an audit
   entry (when enabled).
2. With a supporting provider the block is present in the turn's instructions and
   `EffectivePolicy.appliedTo` contains it; with an unsupporting provider `unsupported` explains why
   and nothing is injected.
3. The rendered block contains no instruction to ignore provider policy; an adapter-level assertion
   confirms the provider's own system prompt is unchanged.
4. Scope is per provider instance; turning it off takes effect on the next turn (never mid-turn).
5. `limitations` is non-empty and shown in the UI; illegal-content exclusions are in the block.

### Test plan

- Unit: `PolicyServiceLive.test.ts` (scope resolution, unsupported reporting),
  `PermissiveInstructionRenderer.test.ts` (golden text, exclusions).
- Adapter integration: one fixture per supporting provider asserting where the block lands; one for
  an unsupporting provider asserting no injection.
- Browser: settings flow + composer banner.

---

## 5. REA built-in

### Goal

REA (reverse-engineering analysis) is always installed and always available: a registered MCP
server, a seeded skill, and auto-activation so agents reach for it on analysis work without the user
asking. Implementation: `ReaService` + `@codeitlab/core/rea`.

Background evidence for the design: `docs/codeitlab/REA-EVIDENCE.md` (the REA 6.7.0 analysis of
`/Applications/CodeItLab (Beta).app`).

### Data model (existing)

`ReaStatus = { installed, version, mcpCommand, mcpArgs[], mcpServerId?, skillInstalled, skillPath?,
autoActivate, health: ReaHealthCheck[], checkedAt? }`;
`ReaHealthCheck = { name, ok, detail, remediation }`;
`ReaCapability = { id, title, description, sideEffects[] }`; settings `rea.enabled`,
`rea.autoActivate`, `rea.mcpCommand`, `rea.mcpArgs`, `rea.installSkill`.

**Correction to the current contract defaults.** The CLI's MCP server mode is `rea --mcp` (stdio),
verified on `rea` 6.7.0 at `/opt/homebrew/bin/rea`; `rea mcp` only has `add`/`doctor` subcommands.
So the defaults should be `mcpCommand: "rea"`, `mcpArgs: ["--mcp"]` when `rea` is on PATH, falling
back to `npx -y rea-agents@6.7.0 --mcp` otherwise. The current default
(`npx … rea-agents@6.7.0 mcp`) is wrong and must be fixed before the installer ships. Health checks
map to `rea doctor` and `rea mcp doctor` (validates startup + tool listing).

Evidence records (addition needed): `ReaEvidenceRef { evidenceId, rootArtifactSha256, subjectPath,
operation, parameters, createdAt, projectId?, threadId?, bundlePath, sizeBytes }` and an
`rea_evidence` SQLite table for cache-by-digest.

### Server service boundary

`apps/server/src/rea/`:

| File                     | Responsibility                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReaServiceLive.ts`      | `status` (installed? version? MCP registration? skill present? health checks), `ensureInstalled` (register MCP server + seed skill), `capabilities` (from `rea capabilities`) |
| `ReaInstaller.ts`        | verifies `rea` availability (`rea doctor`), seeds the skill into the app-managed skills dir, registers `rea --mcp` as the MCP server in the Nexus/MCP registry                |
| `ReaActivationPolicy.ts` | trigger rules (artifact/binary in workspace, `/rea` command, skill invocation) → one-line instruction hint; never auto-runs on huge unknown paths                             |
| `ReaEvidenceStore.ts`    | content-addressed evidence cache; `rea.inspect`-style projections                                                                                                             |
| `toolkits/rea/`          | MCP tools `rea_analyze_app`, `rea_inspect`, `rea_function`, `rea_decompile`, `rea_compare`, `rea_evidence_export`                                                             |

Registration: the MCP server appears in `NexusMcpServer[]` with `mcpServerId`; the toolkit layer is
merged in `apps/server/src/mcp/McpHttpServer.ts` next to the existing toolkits. Auto-activation
injects a one-line hint only when the policy fires (no prompt bloat otherwise).

### Contract changes

- `WS_METHODS`: `codeitlab.rea.getStatus`, `.ensureInstalled`, `.getCapabilities`,
  `.listEvidence`, `.analyze`, `.exportEvidence`.
- Event `rea.status.changed`, `rea.evidence.created`.
- Settings: present; add `rea.maxHeapMb`, `rea.timeoutMs`, `rea.evidenceDir` if limits ship.

### UI surface

- Settings → REA: install status + health checks with remediation, auto-activate toggle, MCP
  command/args (advanced), evidence cache size + clear.
- Right-panel tab "REA": evidence list (digest, artifact, timestamp), boundary summary (windows,
  IPC, bridges), contradictions, "open evidence JSON", "compare versions".
- Composer `/rea` command and a skill badge in the skill list.

### Acceptance criteria

1. Fresh install: `ensureInstalled` registers the MCP server and seeds the skill; `status.health`
   reports each check with remediation; failure is structured, never fatal.
2. On a project containing a `.app`/`.asar`, the first relevant turn offers REA context without the
   user asking; analysis runs as a background job and does not block the turn.
3. Evidence is content-addressed: same digest → cache hit (no second process); changed digest → new
   record + `rea.evidence.created`.
4. MCP tools are visible to every provider session and callable by an agent.
5. Analysis never executes the subject app and never writes outside the evidence dir.
6. UI shows the 13 integrity contradictions and `coverage: partial` for the reference artifact
   without claiming more than the evidence says.

### Test plan

- Unit: `ReaActivationPolicy.test.ts` (triggers, path allow-list), `ReaEvidenceStore.test.ts`
  (digest cache), argument construction (no shell interpolation).
- Integration: fake `rea` executable emitting a small valid envelope; assert job progress, evidence
  write, cache hit, failure mapping.
- MCP: `ReaToolkit.test.ts` through the existing MCP harness.
- Browser: evidence tab renders projections from a fixture.
- Manual: one real run against `/Applications/CodeItLab (Beta).app`.

---

## 6. Ecosystem — OmniRoute, Graft, Ponytail, Caveman

Full evidence and activation design: `docs/codeitlab/ECOSYSTEM.md`. Implementation summary:

- **OmniRoute**: `routing.omniRoute` settings already exist (`enabled`, `baseUrl`, `apiKeyEnv`,
  `virtualModels[]`). The defaults should match this machine's real endpoint
  (`http://100.86.11.88:20128`, 45 `auto/*` virtual models) rather than `127.0.0.1:20128`. A probe
  job refreshes the catalog (`GET /v1/models`; 401 means reachable but unauthenticated — surface,
  don't crash). `RoutingService.catalog.omniRouteModels` feeds the composer and the `omniroute`
  routing mode.
- **Graft**: per-project MCP server `graft mcp <root>` registered through Nexus/MCP, a bundled
  `graft` skill, and a background `graft build`/`graft check` lifecycle. Needs a contract addition
  `CodeItLabGraftSettings { enabled, mode: auto|always|off, deep, maxBuildMinutes, excludeGlobs,
freshnessTtlMs }` and health events.
- **Ponytail / Caveman**: instruction packs composed by `CodeItLabContextService` in fixed order
  (identity/safety → Ponytail → Caveman → REA → user instructions); modes from settings; commands
  registered as composer slash commands. Needs `CodeItLabPolicySettings.packs { ponytail: off|lite|
full|ultra, terse: off|on }` (additive) and a `PolicyPackService` that renders pack text with
  attribution and a token cap.

---

## 7. Local / remote / VPS / Tailscale execution

### Goal

Run a harness where it belongs: locally, on a remote SSH environment, on a VPS, or on a Tailscale
node — with the same threads, settings, and catalogs.

Non-goals: proxying a harness's process through the client; moving workspace files implicitly.

### Model

Preferred (no new transport): a thread on a remote target **lives on that environment's server** —
the client connects through the existing connection runtime (`packages/client-runtime/src/connection/*`),
SSH manager (`packages/ssh`), and Tailscale helpers (`packages/tailscale`). New service
`apps/server/src/execution/ExecutionTargetService.ts` maintains a registry of targets, health
probes, and per-target harness inventory (via the target's own `server.*` RPC over the existing
connection). For ACP specifically, `CodeItLabNexusSettings.customAcpAgents[]` already models
`transport: local|ssh|tailscale` + `host`, which covers "Hermes on my VPS" without a new transport.

Advanced (only when the workspace must stay local while the harness runs remote, e.g. GPU VPS):
`RemoteHarnessAdapter` — a `ProviderAdapterV2` whose "process" is an RPC session on the target
environment; it forwards turn input and mirrors provider events into local orchestration events, and
must declare unsupported capabilities honestly (checkpointing, terminal, preview).

### Contract changes

`execution.listTargets`, `execution.probeTarget`, `execution.getHarnessInventory`, and a thread
target selection (reuse `threads.create` with an environment id). Add
`CodeItLabExecutionSettings { defaultTargetId?, allowRemoteHarness }`. No changes to pairing/relay/
SSH token handling.

### UI surface

- New-thread flow: target picker (Local / connected environments / Tailscale nodes) with latency and
  available harnesses; workspace path validation.
- Settings → Connections gains a target summary card.
- Thread header shows the target; "move to…" explains it creates a new thread (no silent migration).

### Acceptance criteria

1. A thread created on an SSH/Tailscale target runs on that environment's server (verified by a path
   that exists only there); credentials and git are the target's.
2. Target latency/status refreshes without blocking the UI.
3. Harness inventory per target drives the picker and is accurate.
4. Losing the connection does not lose the thread; reconnect resumes the same environment state.
5. The remote-harness adapter is offered only when the target advertises the capability; otherwise
   the UI routes to "create thread on target".
6. No client-side path or credential is used for a remote target.

### Test plan

- Integration: two server instances (one over a loopback SSH tunnel in tests) + connection runtime;
  assert target inventory and thread placement.
- Replay fixtures for `RemoteHarnessAdapter` (capability matrix + failures).
- Manual: Tailscale node + SSH VPS smoke test with a real harness.

---

## 8. UI: 3D, SFX, visual language, control panel

### Goal

A distinctive, fast interface: original Matrix-inspired visual language, a few idle-throttled 3D
elements, synthesized SFX, and a control panel that exposes every new subsystem.

Non-goals: continuous WebGL animation; asset-heavy sound; copying the films' assets, typefaces, or
logos.

### Data model (existing)

`CodeItLabEffectsSettings = { threeD: off|low|medium|high (default medium), respectReducedMotion,
maxFps (default 30), sfxEnabled (default true), sfxVolume (0.35), sfxEvents { click, send, success,
error, ambient } }` under `ServerSettings.codeitlab.effects`. Appearance/theme stays in the existing
client appearance settings (per-client preference).

### Server service boundary

None for visuals. The control panel reads existing RPCs (`codeitlab.nexus.*`, `codeitlab.memory.*`,
`codeitlab.routing.*`, `codeitlab.policy.*`, `codeitlab.rea.*`, `execution.*`, `server.*`) and
subscribes to their events. No server-side rendering.

### UI surface

- **Control panel** (`apps/web/src/routes/control.tsx`, command-palette entry + keyboard shortcut):
  cards for Active harnesses, Route today, Context pressure, Memory facts, REA evidence, Ecosystem
  health, Targets. Each card deep-links to its settings page. One place to see "what codeitlab is
  doing on my behalf".
- **3D elements** (`apps/web/src/components/three/`): `NexusOrb` (catalog size reflected as nodes/
  links), `RouteFlow` (animated route trace on a routed turn), optional `MemoryConstellation`.
  Runtime rules: lazy `import("three")` after mount; one rAF loop per visible scene; render only
  when dirty (data change, pointer interaction, short intro) and stop after `maxFps`/idle timeout
  (default 4 s); pause on `document.hidden`, route change, off-screen (IntersectionObserver); DPR
  capped at 1.5; dispose geometries/materials/textures on unmount; no post-processing by default;
  honor `respectReducedMotion` and `threeD: "off"` (then three.js is never imported).
- **SFX** (`apps/web/src/audio/SfxEngine.ts`): WebAudio synthesis only (oscillator + gain envelope,
  optional noise), no binary assets; `AudioContext` created on first user gesture; master gain +
  per-event toggles from `sfxEvents`; short (< 150 ms), low-volume, distinguishable by pitch contour;
  no sound for events the user is not watching.
- **Visual language** (`apps/web/src/index.css` + `themePalette.ts`): original "phosphor terminal"
  system, not a Matrix clone — tokens `--cl-color-void`, `--cl-color-panel`, `--cl-color-ion`
  (primary), `--cl-color-amber` (warn), `--cl-color-magenta` (danger/highlight), text/muted + a
  data-stream gradient; UI sans + monospace for data; original glyph motifs (abstract ticks, not
  film code rain); 120–200 ms ease-out panel motion; WCAG AA contrast in both themes; reduced-motion
  disables all non-essential motion and 3D; focus rings use the ion accent.
- **"Good UI" acceptance** for every new surface: keyboard reachable, visible focus, no layout shift
  on data load, empty/error/loading states, optimistic updates with rollback, and no spinner that
  lies (a running job shows progress or an honest indeterminate state).

### Acceptance criteria

1. Control panel renders with data from all features; each card deep-links to its settings.
2. Idle 3D: after the idle timeout there are zero rAF callbacks and no repaints (spy on
   `requestAnimationFrame` + fake timers).
3. Hidden tab / off-screen / route change stops the loop; returning resumes only when dirty.
4. `threeD: "off"` or `respectReducedMotion` + OS reduced-motion means three.js is never imported.
5. SFX: no audio before a gesture; no audio network requests; per-event toggles work; master mute
   persists.
6. Theme passes AA contrast in both themes; no hard-coded film assets or typefaces.
7. No continuous animation anywhere else in the app (repo rule): `requestAnimationFrame` outside
   `components/three/` must not grow.

### Test plan

- Browser: control panel cards/deep links/empty states; `threeD: "off"` asserts the dynamic import
  is not called; idle test spies on rAF and advances fake timers.
- Audio: `SfxEngine.test.ts` with mocked `AudioContext` — gesture gating, event mapping, gain,
  dispose.
- Visual: token contrast test (computed styles), reduced-motion test.
- Perf: verify three.js is not in the control-panel initial chunk (build manifest).

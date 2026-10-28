# codeitlab architecture

Read-only analysis of the fork at
`/Users/rumbis/Documents/deepseek-harness/default-workspace/codeitlab` (cloned from
`rumbis/codeitlab` v0.1.1, MIT). Paths are relative to the repo root. This document names the
files, types, and functions an implementer must touch; it deliberately does not restate the
upstream prose in `docs/internals/` (read those too — they carry the constraints).

## 1. Shape of the repo

```
apps/
  server/    Node WebSocket server: orchestration, providers, checkpoints, MCP, auth, persistence
  web/       React 19 + Vite + TanStack Router UI (the product surface; desktop and mobile wrap it)
  desktop/   Electron shell; bundles and can host the server; owns IPC, SSH lifecycle, SnapShot
  mobile/    React Native client
  marketing/ static site
packages/
  contracts/        Effect/Schema wire contracts + derived helpers (the RPC boundary)
  shared/           runtime utils, subpath exports, no barrel
  client-runtime/   client state/connection logic shared by web + mobile
  provider-core/    ProviderDriver + ProviderAdapterV2 abstractions, HostProcess, MCP sessions
  provider-acp/     generic ACP v1/v2 adapter, session runtime, MCP-over-ACP bridge
  provider-acp-registry/  ACP Registry driver/adapter (registry + local command)
  provider-<name>/  per-provider packages: cursor, grok, muse, opencode, pi
  ssh/ tailscale/   remote access transports
  source-control-*/ git host integrations
native/             Rust/C++ helpers (resource monitor, Windows bits)
docs/               user / internals / operations documentation
```

Toolchain: pnpm 11.10.0, `vp` (Vite+) task runner, Effect 3 (`effect`), React 19, Tailwind 4,
TanStack Router, `@effect/atom-react` for client state, SQLite (`apps/server/src/persistence/Sqlite.ts`).

## 2. Runtime model (the rule everything follows)

The environment owns execution. Web/desktop/mobile clients are controllers over authenticated RPC;
they never substitute their own filesystem, provider credentials, or machine state
(`docs/internals/overview.md`). The desktop renderer is _not_ served by the backend — the
`codeitlab://` scheme serves the bundled client and API traffic goes to the environment URL.

Boot path:

| Step                 | File                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Server entry         | `apps/server/src/bin.ts` → `apps/server/src/entrypoint.ts` → `apps/server/src/bootstrap.ts`                          |
| Service graph        | `apps/server/src/server.ts` (`ServerLive` layer assembly), `apps/server/src/orchestration-v2/runtimeLayer.ts`        |
| HTTP + WS            | `apps/server/src/http.ts`, `apps/server/src/ws.ts`                                                                   |
| Auth                 | `apps/server/src/auth/` (`RpcAuthorization.ts`, sessions, pairing)                                                   |
| Environment identity | `apps/server/src/environment/ServerEnvironment.ts`                                                                   |
| Persistence          | `apps/server/src/persistence/` (`Sqlite.ts`, `Migrations/`, `OrchestrationEventStore.ts`, `initializeV2Database.ts`) |

## 3. RPC contract

`packages/contracts/src/rpc.ts` is the single wire boundary.

- `WS_METHODS` (line ~380) enumerates every method: `projects.*`, `agentSessions.*`, `mcpApps.*`,
  `provider.*`, `vcs.*`, `git.*`, `review.*`, `terminal.*`, `preview.*`, `device.*`, `server.*`
  (including the whole `server.*AcpRegistry*` family), `scheduledTasks.*`, `secrets.*`,
  `threads.*`/`orchestration.*` (further down the file), etc.
- Each method has a `Rpc.make(...)` definition (e.g. `WsSubscribeServerConfigRpc`), and all of them
  are collected into `WsRpcGroup` (line ~1882).
- The server implements the group in `apps/server/src/ws.ts`: `ServerWsRpcGroup =
WsRpcGroup.middleware(RpcInstrumentation)` (line 546), `ServerWsRpcGroup.toLayer(...)` (line
  1190), handler map `ServerWsRpcGroup.of({...})` (line 1806), served by
  `RpcServer.make(ServerWsRpcGroup, WS_RPC_SERVER_OPTIONS)` (line 3179).
- Client mutations go through `createEnvironmentRpcCommand` in `packages/client-runtime`; protected
  methods are listed in `CLIENT_GUARDED_RPC_SCOPES` (`packages/contracts/src/clientRpcPermissions.ts`).

Adding a feature therefore means: contract schema + method in `WS_METHODS`/`WsRpcGroup` → one
service method → thin handler in `ws.ts` → client atom/command → UI. Keep `ws.ts` thin; it decodes,
calls one service, maps errors.

## 4. Orchestration v2

Event-sourced, side-effect-free decision layer:

| Component          | File                                                                                                     | Role                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Commands/events    | `packages/contracts/src/orchestrationV2.ts`                                                              | the domain schema (commands, events, projections, capabilities) |
| Orchestrator       | `apps/server/src/orchestration-v2/Orchestrator.ts`                                                       | serializes commands, decides events, no I/O                     |
| Event sink         | `apps/server/src/orchestration-v2/EventSink.ts`                                                          | commits events + projections + receipt + outbox in one tx       |
| Effect worker      | `apps/server/src/orchestration-v2/EffectWorker.ts`                                                       | performs side effects after commit                              |
| Run execution      | `RunExecutionService.ts`, `ProviderTurnStartService.ts`, `RunFinalizationService.ts`                     | drive turns, finalize                                           |
| Ingestion          | `ProviderEventIngestor.ts`, `ProviderSessionManager.ts`, `ProviderAdapterRegistry.ts`                    | adapter events → orchestration events                           |
| Projections        | `ProjectionStore.ts`, `WireProjection.ts`, `ThreadStream.ts`, `threadHistoryPaging.ts`                   | what clients read                                               |
| Compaction/context | `IdleCompactionService.ts`, `ContextHandoffService.ts`, `LiveStreamBudget.ts`, `ContextHandoffBudget.ts` | context control primitives that already exist                   |
| Checkpoints        | `apps/server/src/checkpointing/CheckpointStore.ts`, `orchestration-v2/Checkpoint*.ts`                    | hidden git refs, rollback                                       |

Provider capabilities are a schema, not a driver check:
`OrchestrationV2ProviderCapabilities` (`packages/contracts/src/orchestrationV2.ts:328`) composes
`sessions/threads/turns/streaming/tools/approvals/planning/subagents/context/checkpointing/identity/
runtimePolicy`. Orchestration and clients read those flags; they must never branch on
`driverKind`.

## 5. Provider stack

Three layers, in order of abstraction:

### 5.1 Driver (`ProviderDriver`)

`packages/provider-core/src/server/driver.ts`. A driver is the _instance-level_ integration: display
metadata, settings schema, snapshot (`ManagedServerProvider`), optional usage reader, auth
controller, ACP session management, and the `orchestrationAdapter` (`ProviderAdapterV2["Service"]`).
Registration: `apps/server/src/provider/builtInDrivers.ts` → `BUILT_IN_DRIVERS`, plus
`providerStatusCache.ts` order and `model-manifest.json` policy.

Instances: `packages/contracts/src/providerInstance.ts` (`ProviderInstanceId`,
`ProviderInstanceConfig`, `ProviderInstanceConfigMap`, `defaultInstanceIdForDriver`), managed by
`apps/server/src/provider/ProviderInstanceRegistry.ts`; settings persisted in `providerInstances`
and validated with `makeProviderSettingsSchema` from contracts.

### 5.2 Adapter driver

`packages/provider-core/src/server/adapterDriver.ts` — `ProviderAdapterDriver<Config, R>` with
`driverKind`, `configSchema`, `defaultConfig`, `create(input) → ProviderAdapterV2["Service"]`.
Registration: `apps/server/src/orchestration-v2/builtInProviderAdapterDrivers.ts` →
`BUILT_IN_PROVIDER_ADAPTER_DRIVERS_V2` + `BUILT_IN_PROVIDER_ADAPTER_DRIVER_KINDS_V2`.

### 5.3 Adapter (`ProviderAdapterV2`)

`packages/provider-core/src/server/ProviderAdapter.ts` — an Effect `Context.Service` with
`getCapabilities`, `planSelectionTransition`, `openSession`. A session runtime
(`ProviderAdapterV2SessionRuntime`) exposes:

`ensureThread`, `resumeThread`, `injectHistory?`, `startTurn`, `compactThread?`, `steerTurn`,
`stopTask?`, `interruptTurn`, `stopSubagent?`, `unloadThread?`, `respondToRuntimeRequest`,
`readThreadSnapshot`, `uploadFeedback?`, `mcpApps?`, `rollbackThread`, `forkThread`, plus optional
`subscribeEvents`, `hasPendingBackgroundWork[ForThread]`, `getModelContextWindow`,
`canReuseContextUsage`.

Events are the normalized `ProviderAdapterV2Event` union (`app_thread.created`,
`provider_session.updated`, `provider_thread.updated`, `provider_turn.updated`, `node.updated`,
`subagent.updated`, `message.updated`, `turn_item.updated`, …). This union is where any new
provider-shaped feature must land.

### 5.4 What ships today

| Driver kind   | Driver / adapter                            | Location                                                                                                      |
| ------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `codex`       | `CodexDriver`, `CodexAdapterV2`             | `apps/server/src/provider/Drivers/CodexDriver.ts`, `orchestration-v2/Adapters/CodexAdapterV2.ts`              |
| `claudeAgent` | `ClaudeDriver`, `ClaudeAdapterV2`           | `.../Drivers/ClaudeDriver.ts`, `.../Adapters/ClaudeAdapterV2.ts`                                              |
| `cursor`      | `CursorDriver`, Cursor adapter              | `packages/provider-cursor/src/server/*`                                                                       |
| `grok`        | `GrokDriver`, Grok adapter                  | `packages/provider-grok/src/server/*`                                                                         |
| `opencode`    | `OpenCodeDriver`, 1.x + 2.x adapters        | `packages/provider-opencode/src/server/*`, `.../v2/*`                                                         |
| `antigravity` | `AntigravityDriver`, `AntigravityAdapterV2` | `apps/server/src/provider/{Antigravity*.ts, Drivers/Antigravity*.ts}`, `.../Adapters/AntigravityAdapterV2.ts` |
| `pi`          | `PiDriver`, Pi adapter                      | `packages/provider-pi/src/server/*`                                                                           |
| `muse`        | `MuseDriver`                                | `packages/provider-muse/src/server/*`                                                                         |
| `acpRegistry` | `AcpRegistryDriver`, `AcpRegistryAdapterV2` | `packages/provider-acp-registry/src/server/*`                                                                 |

### 5.5 ACP path (the cheapest way to add a harness)

`packages/provider-acp/` implements the protocol once:

- `src/server/adapter.ts` — `makeAcpAdapterV2`, `ACP_PROTOCOL = "acp.ndjson-jsonrpc"`,
  `AcpProviderCapabilitiesV2`, `acpScopedNativeId`, event projection helpers.
- `src/server/AcpSessionRuntime.ts` — process lifecycle, initialize/authenticate, session
  new/resume, MCP server advertisement, terminal handling.
- `src/server/mcpOverAcpBridge.ts`, `clientTerminals.ts`, `clientPolicy.ts`, `sessionConfig.ts`,
  `runtimeModel.ts`.

`packages/provider-acp-registry/` adds discovery, install, auth, and session management:

- `src/settings.ts` — `AcpRegistrySettings`: `source: "registry" | "local"`, `agentId`,
  `commandPath`, `commandArgs`, `authMethodId`, `distribution`, `customModels`.
- `src/server/AcpRegistrySupport.ts` — registry fetch (`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`),
  npx/uvx/binary install, **local command spawn** (`spawn: { command, args: settings.commandArgs,
cwd, env, shell: false }`).
- `src/server/probe.ts` — `probeAcpRegistryConfiguration`, `listAcpRegistrySessions`,
  `deleteAcpRegistrySession`, `listAcpRegistryProviders`, `setAcpRegistryProvider`,
  `disableAcpRegistryProvider`, `logoutAcpRegistry`.
- `src/server/adapter.ts` — `makeAcpRegistryAdapterV2`, `AcpRegistryAdapterV2Driver`, per-agent
  flavors (`claudeAcp.ts`, `copilotAcp.ts`, `devinAcp.ts`, `droidAcp.ts`).
- RPC surface: `server.searchAcpRegistry`, `server.prepareAcpRegistryAgent`,
  `server.listAcpRegistrySessions`, `server.importAcpRegistrySession`, … in `WS_METHODS`.

This is exactly how Hermes and DeepSeek Harness plug in with zero new provider code — see
`docs/codeitlab/HARNESS-MATRIX.md`. `docs/user/providers-acp.md` already documents the local-command
flow, including `dsh --profile acp` for DeepSeek Harness.

## 6. Contracts and settings flow

- `packages/contracts/src/index.ts` re-exports every contract module; no runtime logic beyond small
  derived helpers.
- Provider settings schemas are built with `makeProviderSettingsSchema` and annotated for the
  settings form (`providerSettingsForm: { control, options, hidden, placeholder, clearWhenEmpty }`)
  — e.g. `packages/provider-acp-registry/src/settings.ts`. The UI renders these generically in
  `apps/web/src/components/settings/ProviderSettingsForm.tsx`; there is no per-driver form.
- Environment settings: `ServerSettings` (`packages/contracts/src/settings.ts:1093`),
  `DEFAULT_SERVER_SETTINGS`, `ServerSettingsPatch`, `ServerSettingsOperation`; server-side
  `apps/server/src/serverSettings.ts` (service + `layer`), RPC `server.getSettings` /
  `server.updateSettings`.
- Scope rules (`docs/internals/overview.md`): client preferences stay on the client; environment
  defaults and project overrides stay on the owning server. The web settings target is URL state
  (`apps/web/src/components/settings/SettingsScopeContext.tsx`, `settingsScope.ts`,
  `scopedSettings.ts`) resolved against connections/project membership — an unavailable target
  never falls back to another environment.
- Client provider registry: `apps/web/src/components/settings/providerDriverMeta.ts`
  (`providerClients = makeProviderClientRegistry([...])`) using `defineProviderClient` from
  `packages/provider-core/src/client.ts`; each package's `./client` export supplies label, settings
  schema, icon, badge. Browser/React-Native safe by contract.

## 7. Web UI structure

`apps/web/src`:

| Area             | Path                                                                                                  | Notes                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot             | `main.tsx`, `bootstrap.ts`, `AppRoot.tsx`                                                             | auth bootstrap, theme boot, router                                                                                                                                     |
| Routes           | `routes/` (TanStack file routes, `routeTree.gen.ts`)                                                  | `_chat.*` (threads/drafts/PRs), `settings.*`, `connect*`, `pair`, `usage`, `welcome`, `projects.$projectKey`                                                           |
| Router           | `router.ts`                                                                                           | route tree + search validation                                                                                                                                         |
| Chat surface     | `components/ChatView.tsx`, `ChatMarkdown.tsx`, `ComposerPromptEditorTiptap.tsx`, `components/chat/*`  | composer banners compose via `ComposerBanner` slots                                                                                                                    |
| Settings         | `components/settings/*`                                                                               | `ProviderSettingsPanel.tsx`, `ProviderInstanceCard.tsx`, `AcpRegistrySearchStep.tsx`, `AddProviderInstanceDialog.tsx`, `SettingsScopeContext.tsx`, `settingsSearch.ts` |
| State            | `state/*.ts`                                                                                          | effect-atom modules: `orchestration.ts`, `entities.ts`, `environments.ts`, `providerInstances.ts`, `agentSessions.ts`, `preview.ts`, …                                 |
| RPC client       | `rpc/` (`atomRegistry.ts`, `transportError.ts`, `requestLatencyState.ts`) + `packages/client-runtime` | raw RPC clients stay inside `rpc/`                                                                                                                                     |
| Composer context | `composer-logic.ts`, `composer-rich-text.ts`, `providerSkillSearch.ts`, `modelSelection.ts`           | `/` skills and `$` mentions                                                                                                                                            |
| Appearance       | `themePalette.ts`, `appearanceContrast.ts`, `appearanceFonts.ts`, `openVsxThemes.ts`, `index.css`     | theme variables, dark/light variants                                                                                                                                   |
| Browser/preview  | `browser*`, `preview*`, `state/preview*`                                                              | webview bridge in desktop                                                                                                                                              |
| Panels           | `rightPanelStore.ts`, `rightPanelLayout.ts`, `diffPanelStore.ts`, `terminal/*`                        | right-side panel system                                                                                                                                                |
| UI primitives    | `components/ui/*`                                                                                     | own their look; variants over restyling                                                                                                                                |

UI rules that constrain new work: Tailwind classes in the owning component (global CSS only for
generated/imperative DOM, animations, runtime theme vars); no static inline styles; React Compiler
must compile every file (`reactCompilerCoverage.test.ts`); `codeitlab/no-manual-memo` bans
`useMemo`/`useCallback`; handlers that leave a large component use `useStableCallback`
(`hooks/useStableCallback.ts`). No continuously repainting animations — this is the rule the 3D/SFX
feature must obey.

**Where a new settings panel goes.** Add a file route `apps/web/src/routes/settings.<name>.tsx`
(follow `settings.providers.tsx`), register the nav entry in `apps/web/src/routes/settings.tsx`
(section list around line 116–160), add search entries to `components/settings/settingsSearch.ts`
(+ `useAvailableSettingsSearchItems.ts`), and put the panel body in
`apps/web/src/components/settings/<Name>Settings.tsx`. Environment-scoped values are read/written
through `useScopedSettings`/`scopedSettings.ts`, never ad hoc.

## 8. Remote execution

`docs/internals/remote.md` is the authority. Implementation:

- Connection: `packages/client-runtime/src/connection/{driver,supervisor}.ts` — ordered route list,
  first route that works, preflight, learned routes, no loopback fallback.
- SSH: `packages/ssh/src/tunnel.ts` — `SshEnvironmentManager`, `launchOrReuseRemoteServer`,
  `issueRemotePairingToken`, `buildRemoteLaunchScript`, `waitForHttpReady`,
  `resolveLoopbackSshHttpBaseUrl`. Desktop main owns the SSH lifecycle because it can spawn SSH and
  answer prompts; the renderer uses the forwarded endpoint through the normal connection runtime.
- Tailscale: `packages/tailscale/src/tailscale.ts` — `readTailscaleStatus`, `parseTailscaleStatus`,
  `buildTailscaleHttpsBaseUrl`, `ensureTailscaleServe`, `disableTailscaleServe`,
  `probeTailscaleHttpsEndpoint`.
- Desktop local-environment toggle: `apps/desktop/src/settings/DesktopAppSettings.ts`
  (`localEnvironmentEnabled`) + `desktopBridge.getLocalEnvironmentEnabled()`.

Any new harness/feature must work identically when the server is remote: no client-side paths, no
client-side credentials, no client-side process spawning.

## 9. MCP surface (where REA, Nexus, memory tools plug in)

The server already _is_ an MCP server to providers:

- `apps/server/src/mcp/McpHttpServer.ts` — `McpServer.layerHttp`, toolkit layers
  (`layerHtmlToolkit`, `layerPreviewToolkit`, `layerOrchestratorToolkit`, `layerThreadToolkit`,
  `layerEnvironmentToolkit`, `layerAttachmentToolkit`, `layerPullRequestsToolkit`,
  `layerDeviceToolkit`), `toolkitRegistration` helper.
- Toolkits: `apps/server/src/mcp/toolkits/{orchestrator,thread,project,preview,previewControls,
environment,attachment,pullRequests,device,html,worktree,core.test.ts}`.
- Access/authorization: `McpInvocationContext.ts`, `McpToolAccess.ts`, `McpSessionRegistry.ts`,
  `threadAccess.ts`.
- Contracts for the tools: `packages/contracts/src/orchestratorMcp.ts`,
  `threadMetadataMcp.ts`, `worktreeMcp.ts`, `mcpApps.ts`.
- Provider side: `packages/provider-core/src/server/McpProviderSessions.ts` +
  `mcpSession.ts` (`McpProviderSessionConfig`) hold the per-thread MCP server config; each adapter
  injects it (ACP: `mcpServers` in `AcpSessionRuntime.ts`/`adapter.ts`; Cursor:
  `cursorMcpServers(...)` in `packages/provider-cursor/src/server/adapter.ts`; Codex/Claude have
  equivalent injection in their adapters). `AcpMcpStdioBridge.ts` serves the same tools to ACP
  agents that only accept stdio MCP servers.

New MCP capability = new toolkit + layer + contract input schema + capability check. That is the
pattern REA (`layerReaToolkit`) and memory (`layerMemoryToolkit`) should copy.

## 10. Extension points for the codeitlab features

### 10.1 New provider: Hermes

Two options, in order of cost:

1. **No code — local ACP instance.** `source: "local"`, `commandPath: /Users/rumbis/.local/bin/hermes`,
   `commandArgs: ["acp"]` (plus `--accept-hooks` if the environment has no TTY and the user accepts
   hooks), `agentId: "hermes"` optional. The generic `AcpRegistryAdapterV2` handles it. Models come
   from ACP; skills/sessions/MCP stay owned by Hermes.
2. **Dedicated flavor** only if Hermes needs behavior ACP does not carry: add
   a provider package modelled on `packages/provider-acp/` with `./settings`, `./client`, `./server`, `./testing`; a small
   `makeHermesAdapterV2` over `makeAcpAdapterV2` (like `packages/provider-grok/src/server/*`); a
   driver; then register in `apps/server/src/provider/builtInDrivers.ts`,
   `apps/server/src/orchestration-v2/builtInProviderAdapterDrivers.ts`,
   `apps/web/src/components/settings/providerDriverMeta.ts`, `providerStatusCache.ts`,
   `model-manifest.json`, plus `docs/user/providers-hermes.md`. Also add the package to
   `pnpm-workspace.yaml` and the knip workspace list in `package.json`.

### 10.2 New settings panel

Covered in §7. For a codeitlab-owned panel (`Nexus`, `Memory`, `Boost`, `Uncensored`, `REA`,
`Ecosystem`), the value is environment-scoped: extend `ServerSettings` in
`packages/contracts/src/settings.ts`, add the service read/write in
`apps/server/src/serverSettings.ts`, expose `server.getSettings`/`server.updateSettings` (already
generic via `ServerSettingsPatch`), then render with `useScopedSettings`.

### 10.3 Memory subsystem

Nothing exists today: no memory tables, no extraction pipeline, no retrieval injection. The
pluggable seams are:

- **Storage**: `apps/server/src/persistence/` already owns SQLite + migrations
  (`Migrations/`, `initializeV2Database.ts`). Add `MemoryStore.ts` + a migration. Hermes's schema is
  the reference (`~/.hermes/memory_store.db`: `facts`, `fact_versions`, `entities`, `fact_entities`,
  `entity_aliases`, `facts_fts` FTS5, `forgotten`, `memory_banks`) — see HARNESS-MATRIX.
- **Write path**: an effect in the turn-finalization flow — `RunFinalizationService.ts` /
  `EffectWorker.ts` — that runs extraction after a turn settles (never inside the orchestrator or
  the command transaction).
- **Read path**: `ProviderAdapterV2TurnInput.appContext` (`packages/provider-core/src/server/
ProviderAdapter.ts`) is the existing per-turn context channel; `RunExecutionService`/
  `ProviderTurnStartService` assemble it. Add retrieved facts there, and optionally a
  `memory.search` MCP tool in a new toolkit.
- **Scopes**: `global` (environment), `project` (projectId), `thread` (threadId). Contracts in a new
  `packages/codeitlab/src/memory.ts`; RPC `memory.*` in `WS_METHODS`.
- **UI**: `apps/web/src/components/codeitlab/CodeItLabMemoryPage.tsx` + route
  `apps/web/src/routes/settings.codeitlab.memory.tsx`, and a thread-scoped inspector panel using
  the existing right-panel system.

### 10.4 Nexus (unified ACP catalog)

The pieces already exist but are per-instance: `ServerProviderWorkspaceSnapshot.skills`
(`packages/contracts/src/server.ts:108`, `:134`), `providerSkillSearch.ts` on the client,
`agentSessions.scan`/`agentSessions.import` (`packages/contracts/src/agentSessions.ts`), ACP session
management (`probe.ts`), and per-provider MCP config. Nexus is a new server service
(`apps/server/src/codeitlab/nexus/`) that queries every enabled instance through the driver snapshot/probe
APIs, dedupes by content hash, and serves one catalog over new `nexus.*` RPC methods. It must not
add per-driver branches: everything it needs is already in `ProviderDriver`/adapter snapshots.

### 10.5 Boost layer (speed, context, routing)

Existing hooks: `LiveStreamBudget.ts` (stream buffering), `ContextHandoffService.ts` +
`ContextHandoffBudget.ts` + `IdleCompactionService.ts` (compaction/handoff), `providerModels.ts` /
`modelSelection.ts` (selection), `usage` services (quota), `packages/contracts/src/providerUsageLimits.ts`.
Missing: a task classifier + routing policy service, prompt-cache accounting, parallel-tool
orchestration policy. All of it belongs in a new server-side service (there is no boost module in
the repo today) with settings and
a `boost.route` decision surfaced on the turn (not inside the orchestrator).

### 10.6 Uncensored mode

A settings toggle that changes the _injected_ system/developer instructions per provider, with
honest capability reporting. Injection points exist: `orchestrationInstructions.ts`,
`runtimeInstructions.ts`, `packages/provider-core/src/server/orchestrationInstructions.ts`,
`CodexDeveloperInstructions.ts`, and ACP session `systemPrompt`/instruction blocks. The setting must
be a per-instance, per-project-scoped policy with a visible scope banner, and must report
"unsupported" for providers that do not accept instruction overrides rather than silently
pretending.

### 10.7 3D + SFX

No 3D or audio dependency exists today (`apps/web/package.json` has no `three`, no audio lib).
Add `three` to `apps/web` only, behind a lazy route-level import, render on demand
(`requestAnimationFrame` only while visible and dirty), pause on `document.hidden` and on idle
timeout, and expose an appearance setting to disable. SFX must be WebAudio-synthesized (no binary
assets), gated behind a user gesture to satisfy autoplay policy, and disabled by default in
remote/low-power contexts. See FEATURE-SPEC for acceptance criteria.

## 11. File map for the codeitlab work

| Concern         | Files to add                                                                                                                                                                                   | Files to modify                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts       | `packages/contracts/src/{nexus,memory,boost,rea,ecosystem}.ts`                                                                                                                                 | `packages/contracts/src/index.ts`, `rpc.ts` (`WS_METHODS` + group), `settings.ts`, `provider.ts`/`server.ts` (catalog types)                                                         |
| Server services | `apps/server/src/{nexus,memory,boost,rea,ecosystem}/`                                                                                                                                          | `apps/server/src/server.ts` (layers), `ws.ts` (handlers), `bootstrap.ts` (startup), `persistence/Migrations/`                                                                        |
| MCP             | `apps/server/src/mcp/toolkits/{rea,memory,nexus}/`                                                                                                                                             | `apps/server/src/mcp/McpHttpServer.ts` (toolkit layers)                                                                                                                              |
| Providers       | a sibling of `packages/provider-acp/` (only if a flavor is needed)                                                                                                                             | `builtInDrivers.ts`, `builtInProviderAdapterDrivers.ts`, `providerStatusCache.ts`, `model-manifest.json`, `providerDriverMeta.ts`, `pnpm-workspace.yaml`, `package.json` (knip list) |
| Web             | `apps/web/src/routes/settings.{nexus,memory,boost,rea,ecosystem,uncensored}.tsx`, `apps/web/src/components/{nexus,memory,boost,rea,ecosystem}/*`, `apps/web/src/state/{nexus,memory,boost}.ts` | `routes/settings.tsx` (nav), `settingsSearch.ts`, `providerDriverMeta.ts`, `index.css` (theme tokens), `package.json` (three)                                                        |
| Docs            | `docs/codeitlab/*` (this set), `docs/user/*` for shipped features                                                                                                                              | `docs/README.md` index if the Lead wants them discoverable                                                                                                                           |

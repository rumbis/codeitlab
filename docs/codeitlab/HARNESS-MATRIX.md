# Harness matrix: every agent we must support

Scope: the harnesses codeitlab must ingest (skills, sessions, MCP servers) and/or run. Two classes:

- **Native protocol adapters** already in the fork (Codex app-server, Claude Agent SDK, Cursor SDK,
  OpenCode SDK 1.x/2.x, Grok ACP + xAI extensions, Pi RPC, Antigravity ACP, Muse).
- **ACP agents** — anything speaking the Agent Client Protocol, run either from the official
  registry or as a local command. Hermes and DeepSeek Harness are ACP; so are Gemini CLI, Claude
  Agent (`claude-acp`), Codex (`codex-acp`), Grok Build, OpenCode, Cursor, and 37 other registry
  entries.

Verified on this machine (2026-10-22, read-only): `hermes acp --check` → `Hermes ACP check OK`;
`hermes-acp --version` → `0.22.4`; `hermes --version` → `Hermes Agent v0.22.4 (2026.9.24) · stable ·
local 4d04303818b6`, install `/Users/rumbis/.hermes/hermes-agent`, Python 3.14.7; `graft --version` →
`0.21.1`; `rea --version` → `6.7.0`; `/tmp/ref/acp-registry.json` → 43 agents. Installed harness
CLIs here: `claude` (`/opt/homebrew/bin/claude`) only. Codex/Grok/OpenCode/Gemini/Pi/Cursor CLIs are
not installed, so their rows are derived from the fork's source and docs, and marked _(source)_.

## Matrix

| Harness                    | Launched as                                                                                                                                                                                                  | Auth                                                                                                                   | Skills live in                                                                                                                                                                                   | Sessions live in                                                                                                                                                                         | MCP servers configured in                                                                                                                 | codeitlab integration                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hermes**                 | `hermes acp` (stdio ACP). Binary `/Users/rumbis/.local/bin/hermes` → `~/.hermes/hermes-agent/.hermes/bin/hermes-acp`. Flags: `--accept-hooks`, `--check`, `--setup`, `--setup-browser`, `--version`          | `~/.hermes/auth.json` + provider keys in `~/.hermes/.env`/`config.yaml`; OAuth/device flows via `hermes`               | `~/.hermes/skills/<bundle>/<skill>/SKILL.md`; plugin skills (`~/.hermes/plugins/ponytail/skills`); `skills.external_dirs` in config                                                              | `~/.hermes/sessions/*.jsonl` (72 files, 12 MB) + `~/.hermes/state.db` (SQLite, FTS)                                                                                                      | `~/.hermes/config.yaml` → `mcp_servers:` (zapier, stitch, fishaudio, notebooklm, graft, facebook, facebook-web, vibes, avatar)            | **Local ACP instance** (`source: local`, command `hermes`, args `["acp"]`). No new code.                                                     |
| **DeepSeek Harness (DSH)** | `dsh --profile acp` (documented in `docs/user/providers-acp.md`); desktop app `/Applications/DeepSeek Harness.app`; runtime `@deepseek-ai/dsh-acp`                                                           | `~/.dsh/.credentials.yaml` (+ DeepSeek account plugins)                                                                | `.agents/skills/`, `.dsh/skills/` (`dsh-skill-filesystem`), `SKILL.md`; `dsh-experimental-badge-skill-bundle`                                                                                    | `~/.dsh/sessions/<workspace-slug>/<session-id>/session.v4.jsonl.zstd` (+ `session.lock`); projection cache `~/.dsh/storages/session_projcache/sessions/*.json`; versioned format `v0→v4` | Cordis profile plugins (`~/.dsh/profiles/desktop/cordis.yml` + `cordis.patch.yml`), `dsh-mcp-client`                                      | **Local ACP instance** (`source: local`, command `dsh`, args `["--profile","acp"]`). Session files also directly ingestible (zstd JSONL v4). |
| **Claude Code**            | Native adapter via `@anthropic-ai/claude-agent-sdk` ^0.3.276 (`apps/server/src/provider/Drivers/ClaudeDriver.ts`, `orchestration-v2/Adapters/ClaudeAdapterV2.ts`). Registry alternative: `claude-acp` 0.94.0 | `claude` login (OAuth) → keychain/`~/.claude/.credentials.json`; `ANTHROPIC_API_KEY`; Claude Max subscription          | `~/.claude/skills`, `<cwd>/.claude/skills`, plugin marketplaces (`~/.claude/plugins`); frontmatter `disable-model-invocation` / `user-invocable` mapped in `ClaudeSkills.ts`                     | `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` (+ per-project `memory/`), `~/.claude/history.jsonl`                                                                             | `~/.claude.json` (global `mcpServers` + per-project `mcpServers`/`enabledMcpjsonServers`), project `.mcp.json`                            | Native adapter (default) or registry `claude-acp`. Session import: `agentSessions.scan`/`import` (`AgentSessionSource = "claudeAgent"`).     |
| **Codex**                  | Native adapter over the app-server JSON-RPC protocol (`packages/effect-codex-app-server/`). Registry alternative: `codex-acp` 2.2.2                                                                          | `codex login` (ChatGPT OAuth) or `OPENAI_API_KEY`; `~/.codex/auth.json`; managed/shadow homes per `CodexHomeLayout.ts` | `~/.codex/skills`, `<cwd>/.codex/skills`, `~/.codex/plugins`, `AGENTS.md` instructions                                                                                                           | `~/.codex/sessions/`, `~/.codex/archived_sessions/`, `~/.codex/sqlite/` (see `KNOWN_SHARED_DIRECTORIES` in `CodexHomeLayout.ts`)                                                         | `~/.codex/config.toml` `[mcp_servers]`; codeitlab injects its thread MCP server into the app-server session                               | Native adapter (default) or registry `codex-acp`. Session import: `agentSessions` (`AgentSessionSource = "codex"`).                          |
| **Cursor**                 | `@cursor/sdk` 1.0.35 (`packages/provider-cursor/src/server/adapter.ts`) — cloud agent, no local CLI needed                                                                                                   | Cursor account; `~/.cursor/auth.json` or keychain (`cursorKeychainUsageEnabled`); usage `https://api2.cursor.sh`       | Union scanner `packages/provider-cursor/src/server/skills.ts`: `~/.cursor/skills`, `<cwd>/.cursor/skills`, `.agents/skills`, `.codex/skills`, `.claude/skills` (user + project, with link-dedup) | Cursor cloud (SDK); codeitlab keeps its own provider thread/session records; no local transcript contract                                                                                | Cursor's own `.cursor/mcp.json`; codeitlab injects `cursorMcpServers(...)` per turn                                                       | Native adapter. Registry alternative: `cursor` 2026.10.19.                                                                                   |
| **Grok**                   | `grok` CLI in ACP mode (`grokAcpSpawnArgs`, `packages/provider-grok/src/server/acpSupport.ts`) + xAI ACP extensions (`xaiAcpExtension.ts`)                                                                   | `grok login` / `grok login --device-auth`; `GROK_HOME` or `~/.grok`                                                    | `~/.grok/skills`, `<cwd>/.grok/skills`, `~/.grok/installed-plugins/**/skills`, bundled skills — discovered via `grok inspect --json` (`skills.ts`, honors Grok's ignore lists)                   | `~/.grok/sessions/` (path regex in `xaiAcpExtension.ts`), plan artifacts `…/sessions/**/plan.md`                                                                                         | Grok's own config; codeitlab injects the thread MCP server over ACP                                                                       | Native adapter. Registry alternative: `grok-build` 1.0.67.                                                                                   |
| **OpenCode**               | `opencode` server: 1.x one managed server per thread (`OpenCodeServerOwner.ts`), 2.x one server per instance (`v2/OpenCode2Server.ts`); SDK `@opencode-ai/sdk` 1.3.15 / `@opencode/*` 2.0.28                 | `opencode auth login` (provider keys in OpenCode's own store)                                                          | OpenCode workspace inventory `skills` (surfaced through `OpenCodeInventory["skills"]`, `provider-opencode/src/server/status.ts`)                                                                 | OpenCode server storage (external or T3-managed); ACP/registry session management lists them                                                                                             | OpenCode config `mcp` entries — **directory-scoped**; codeitlab registers `t3-code-<thread>` per thread and denies other threads' entries | Native adapter. Registry alternative: `opencode` / `opencode-v2`.                                                                            |
| **Gemini**                 | ACP registry `gemini` (v0.65.0, npx `@google/gemini-cli`) with `--experimental-acp`; also reachable through Antigravity's `~/.gemini` linkage                                                                | Google OAuth (browser/device) or `GEMINI_API_KEY`                                                                      | `~/.gemini/skills`, `<cwd>/.gemini/skills` (the fork's `AntigravitySkills.ts` links these into the Antigravity profile)                                                                          | `~/.gemini/` (Gemini CLI's own store); ACP `session/list` where advertised                                                                                                               | `~/.gemini/settings.json` `mcpServers`; codeitlab injects the thread MCP server over ACP                                                  | Registry ACP agent (no dedicated driver).                                                                                                    |
| **Antigravity**            | ACP registry `antigravity-acp` 1.4.1; profile-isolated install (`AntigravityInstallation.ts`, `antigravityAuthSupport.ts`)                                                                                   | Per-profile credentials; forced file-based storage (keychain would be shared); ambient Google creds stripped           | `~/.gemini` user-global skill dirs linked into the profile (`AntigravitySkills.ts`)                                                                                                              | Antigravity agent's own store under the profile                                                                                                                                          | Profile-local; hooks/rules in `~/.gemini` intentionally excluded                                                                          | Native adapter (profile isolation, leases, immutable releases).                                                                              |
| **Pi**                     | User's own `pi` in RPC mode (`packages/provider-pi/src/server/adapter.ts`)                                                                                                                                   | Pi's own `/login` / API keys in `~/.pi/agent`                                                                          | Pi `get_commands` payload → `commands.ts` maps commands + skills                                                                                                                                 | `~/.pi/agent` sessions (native resume/rollback/fork)                                                                                                                                     | Pi extension/package config; codeitlab injects only its namespaced MCP bridge                                                             | Native adapter. Registry alternative: `pi-acp`.                                                                                              |
| **Muse**                   | Native `MuseDriver` (`packages/provider-muse/src/server/*`)                                                                                                                                                  | Muse account/keys                                                                                                      | Muse's own                                                                                                                                                                                       | Muse's own                                                                                                                                                                               | Muse's own; thread MCP injected                                                                                                           | Native adapter.                                                                                                                              |
| **Generic ACP registry**   | `npx` (exact version), `uvx`, or per-platform `binary` archive; install under T3 home `tools/<agent-id>/<version>/`; or a **local command** (`source: local`, `commandPath`, `commandArgs`)                  | Agent-owned; browser URL or terminal sign-in driven by `provider.auth.*` RPCs                                          | Agent-owned; ACP does not describe skills — only what the agent advertises in prompts/commands                                                                                                   | ACP `session/list` where supported (`probe.ts:listAcpRegistrySessions`), else agent-owned                                                                                                | ACP `session/new` `mcpServers` array (`AcpSessionRuntime.ts`); stdio bridge `AcpMcpStdioBridge.ts` for stdio-only agents                  | `AcpRegistryAdapterV2Driver` — one generic driver, no per-agent branches. 43 agents in the current registry.                                 |

Registry snapshot (`/tmp/ref/acp-registry.json`, v1.0.0, 43 agents): agoragentic-acp, amp-acp,
antigravity-acp, auggie, autohand, bob, claude-acp, cline, codebuddy-code, codex-acp, cortex-code,
corust-agent, crow-cli, cursor, deepagents, devin, dimcode, dirac, factory-droid, fast-agent, gemini,
github-copilot-cli, glm-acp-agent, goose, grok-build, harn, junie, kilo, kimchi, kimi, minimax-code,
minion-code, mistral-vibe, nova, opencode, opencode-v2, pi-acp, poolside, qoder, qwen-code, sigit,
stakpak, vtcode.

## Per-harness detail

### Hermes (verified)

```
/Users/rumbis/.local/bin/hermes            # shim
~/.hermes/hermes-agent/.hermes/bin/hermes-acp  # POSIX shell wrapper, exec's the real adapter
hermes acp --check        → "Hermes ACP check OK"
hermes-acp --version      → 0.22.4
hermes --version          → Hermes Agent v0.22.4 (2026.9.24) · stable · local 4d04303818b6
```

- ACP entry: `hermes acp`; `--accept-hooks` auto-approves unseen shell hooks without a TTY
  (`HERMES_ACCEPT_HOOKS=1` equivalent) — required for headless/remote launch, and it is a real
  security decision, so it must be an explicit instance setting in codeitlab, never a default.
- Config surface (`~/.hermes/config.yaml`, 3,474 lines, `_config_version: 51`): `model`,
  `providers` (2,600+ lines of model routes incl. `auto/*`), `agent`, `memory`, `skills`,
  `plugins`, `hooks`, `mcp_servers`, `toolsets`, `sessions`, `approvals`, `security`.
- Memory: `~/.hermes/memory_store.db` (SQLite) with `facts`, `fact_versions` (bitemporal
  valid_from/valid_to, supersedes/superseded_by), `entities`, `fact_entities`, `entity_aliases`,
  `facts_fts` (FTS5), `forgotten`, `memory_banks` (HRR vectors). Plus human-readable
  `~/.hermes/memories/MEMORY.md` and `USER.md`, `§`-separated entries. `memory.provider:
holographic`, `memory_enabled: true`, `nudge_interval: 10`, `flush_min_turns: 6`.
- Skills: `~/.hermes/skills/` holds 30+ bundles (`graft`, `hyperframes*`, `media*`, `research`,
  `software-development`, …), each a directory of `SKILL.md` files; plugin skills come from
  `~/.hermes/plugins/<plugin>/skills`; `skills.disabled` and `skills.external_dirs` are config.
- Sessions: `~/.hermes/sessions/*.jsonl` (role/content records, tool results inline), 72 files /
  12 MB; `~/.hermes/state.db` is the queryable session/state store.
- MCP: `mcp_servers:` in `config.yaml` (9 entries). `graft` is
  `/opt/homebrew/bin/graft` with args `["mcp"]`, `DO_NOT_TRACK=1`.
- Hooks: `~/.hermes/agent-hooks/caveman-lite.py` registered under `hooks.pre_llm_call` (always-on
  terse-output rule). Plugin `ponytail` 5.1.1 provides `pre_llm_call` + `pre_gateway_dispatch`
  hooks, 6 commands, 6 skills.

### DeepSeek Harness (verified layout, source-derived launch)

- Desktop runtime `@deepseek-ai/dsh-desktop-runtime` 0.2.1-rc.2, Cordis-based, **305**
  `@deepseek-ai/dsh-*` packages. Relevant plugins: `dsh-acp`, `dsh-acp-app`, `dsh-agent`,
  `dsh-agent-instructions`, `dsh-compaction*`, `dsh-mcp-client`, `dsh-session*`,
  `dsh-skill`, `dsh-skill-filesystem`, `dsh-tool-skill`, `dsh-session-query-sqlite`.
- Launch for ACP: `dsh --profile acp` (the fork's own user docs say exactly this). The desktop app
  is the other surface; it bundles the runtime.
- Skills: `.agents/skills` and `.dsh/skills`, each skill a `SKILL.md`; badges via
  `dsh-experimental-badge-skill-bundle`.
- Sessions: `~/.dsh/sessions/<slugified-cwd>/<id>/session.v4.jsonl.zstd`. Format v4 = JSONL of
  typed records: `session` (id, createdAt, cwd, parentSession, origin, delegationDepth,
  agentPreset), `subagent/descriptor`, `sandbox/mode`, `approval/policy`, `permission/preset`,
  `agent/inbox/spliced`, `turn/start`, … with monotonic `seq`. Migrations v0→v4 exist as separate
  plugins. Projection cache: `~/.dsh/storages/session_projcache/sessions/<id>.json`.
- **No dedicated memory plugin** in 0.2.1-rc.2. The only `memory` artifacts in the shipped runtime
  are Anthropic SDK beta `memory-stores` files (unused by DSH). DSH's "memory-like" mechanisms are
  `dsh-agent-instructions` (AGENTS.md dev context), `dsh-persona`, session search
  (`dsh-experimental-session-search`) and compaction. Any "memory like DeepSeek Harness" claim in
  our specs must therefore be understood as _Hermes-style fact memory_, not a DSH feature.
- MCP: `dsh-mcp-client` + profile `cordis.yml`/`cordis.patch.yml`; the desktop profile's
  `cordis.patch.yml` is where the user's OmniRoute provider (`llm-pi-ai` → `http://100.86.11.88:20128/v1`,
  models `auto/best-coding`, `auto/best-fast`, `auto/best-coding-fast`, …) is configured.
- Auth: `~/.dsh/.credentials.yaml` (mode 0600); DeepSeek account plugins.

### Claude Code

- Native path: `@anthropic-ai/claude-agent-sdk` ^0.3.276 in `apps/server`; adapter
  `ClaudeAdapterV2` + `ClaudeProvider.ts`, model catalog `ClaudeModelCatalog.ts`, token usage
  `ClaudeTurnTokenUsage.ts`, skills `Drivers/ClaudeSkills.ts`, home `Drivers/ClaudeHome.ts`.
- Skills parsing is the most complete in the fork: YAML frontmatter with Claude's YAML 1.1 boolean
  spellings, `disable-model-invocation` → `userInvocationOnly`, `user-invocable: false` →
  `userInvocable`, project `.claude/settings.json` / `settings.local.json`.
- Sessions: `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`; a `memory/` subdirectory per project
  exists on this machine; `agentSessions.scan` imports these into codeitlab.
- MCP: `~/.claude.json` global + per-project `mcpServers` (verified: global `exa`; 3 projects with
  their own `mcpServers`), plus `.mcp.json`.

### Codex

- Native path: `packages/effect-codex-app-server/` (client/protocol/rpc/replay) — codeitlab speaks
  the Codex app-server protocol, not a CLI scrape. `CodexProvider.ts`, `CodexAdapterV2.ts`,
  `CodexManagedHome.ts`, `CodexChatGptAuth.ts`, `CodexMcpElicitation.ts`.
- Home layout is explicit (`Drivers/CodexHomeLayout.ts`): shared dirs `sessions`,
  `archived_sessions`, `sqlite`, `shell_snapshots`, `worktrees`, `skills`, `plugins`, `cache`,
  `logs`, `mcp-oauth-locks`; private `auth.json`, `models_cache.json`; local-only `log`, `memories`,
  `tmp`. So Codex **does** have a `memories/` directory — a merge source for our memory feature.
- This machine: `~/.codex/` has many `<model>.config.toml` profiles but no `config.toml`, no
  `sessions/`, and no `codex` binary — i.e. stale config, not a usable install.

### Cursor

- `@cursor/sdk` 1.0.35; adapter `packages/provider-cursor/src/server/adapter.ts`; usage
  `CursorUsageAccounts.ts` (`~/.cursor/auth.json`, keychain); text generation refuses custom
  `~/.cursor/sandbox.json` because it cannot enforce workspace isolation.
- Skill scanner is already a **union** across `.cursor/skills`, `.codex/skills`, `.claude/skills`,
  `.agents/skills` (user + project) with symlink dedup — this is the precedent Nexus should
  generalize.

### Grok

- `grok` CLI over ACP (`acpSupport.ts`) plus xAI-specific ACP extensions
  (`xaiAcpExtension.ts`: session plan paths, model/usage metadata). Skills are discovered by
  asking the CLI (`grok inspect --json`) rather than scanning, because Grok's own ignore lists and
  plugin skills live three levels deep under `~/.grok/installed-plugins/`. Probe timeout 4 s.

### OpenCode

- 1.x and 2.x have different ownership models and the fork handles both (see
  `docs/internals/providers.md`): 1.x one T3-managed server per thread; 2.x one server per
  instance with per-thread `t3-code-<thread>` MCP entries and session permission rules denying
  other threads. MCP registrations are directory-scoped in OpenCode, thread-scoped in T3.
- Skills come from the OpenCode workspace inventory, not a filesystem scan.

### Gemini / Antigravity

- Gemini CLI is registry-only for us: `gemini` v0.65.0, npx, `--experimental-acp`. Antigravity has
  a dedicated driver because it needs profile isolation, installer leases, and `~/.gemini` skill
  linking. Both share the `~/.gemini` user-global skill root.

### Pi / Muse

- Pi runs the user's own `pi` in RPC mode and owns extension/package/project-trust discovery; T3
  injects only its namespaced MCP bridge. Sessions in `~/.pi/agent`.
- Muse is a native driver with no ACP registry entry in the current snapshot.

## Ingestion and merge design (one unified catalog)

Nexus must read all of the above without writing to any harness's config. Four source classes:

1. **ACP probe** (preferred, portable): `probeAcpRegistryConfiguration` gives models, config
   options, auth methods; `listAcpRegistrySessions` gives sessions where the agent advertises
   `session/list`. Skills are _not_ in ACP — they come from class 2/3.
2. **Filesystem scanners** for skill roots (the fork already has four implementations:
   `ClaudeSkills.ts`, `provider-cursor/src/server/skills.ts`, `provider-grok/src/server/skills.ts`,
   `AntigravitySkills.ts`, plus `provider-pi/src/server/commands.ts`). Generalize them behind one
   `SkillSource` interface returning `ServerProviderSkill`-shaped records.
3. **Native session readers**: Claude JSONL, Codex rollouts, DSH v4 zstd JSONL, Hermes JSONL +
   `state.db`. Read-only, streamed, with a size/inode guard (the existing `agentSessions.ts`
   contract already models `device`/`inode`/`birthtimeMs` for exactly this).
4. **MCP config readers**: Hermes `config.yaml:mcp_servers`, Claude `~/.claude.json` + `.mcp.json`,
   Codex `config.toml`, OpenCode config `mcp`, Gemini `settings.json`, Cursor `.cursor/mcp.json`,
   DSH Cordis profile. Normalize to the ACP `McpServer` shape (stdio: command/args/env; http:
   url/headers; sse where supported).

Normalized records (new `packages/contracts/src/nexus.ts`):

```ts
NexusSkill   { id, name, description, source: {harness, instanceId, scope: "project"|"user"|"plugin"|"bundled"},
               path, enabled, contentHash, userInvocable, userInvocationOnly, lastSeenAt }
NexusSession { id, harness, instanceId, projectPath, title, createdAt, updatedAt, messageCount,
               nativeId, readable: boolean, importable: boolean, format }
NexusMcpServer { id, name, transport: "stdio"|"http"|"sse", command?, args?, envKeys?, url?,
                 source: {harness, instanceId, scope}, enabled, configHash }
NexusCatalog { skills[], sessions[], mcpServers[], providers[], generatedAt, staleSources[] }
```

Merge rules:

- **Identity.** `id = sha256(harness + ":" + instanceId + ":" + nativeKey)`; `contentHash` for
  skills = file bytes; `configHash` for MCP = canonical JSON of the normalized config (secrets
  excluded, env values replaced by presence flags).
- **Precedence** for display when the same skill name appears in several places:
  project > user > plugin > bundled; within a scope, the harness whose adapter is native
  (Codex/Claude/Cursor/Grok/OpenCode/Pi) beats generic ACP agents. Never silently hide a
  duplicate: the UI shows one row with a "sources: 3" expander.
- **MCP dedupe.** Same `(name, transport, canonical target)` collapses; conflicting env/headers
  produce a conflict row, not a winner. Injection is per-session: codeitlab merges its own thread
  MCP server + the selected catalog entries into the ACP `mcpServers`/SDK option at session start.
  It never rewrites a provider's config file.
- **Sessions** are read-only; "Import" copies a transcript into a codeitlab thread (the existing
  `agentSessions.import` flow) and records `nativeId` for reference. Cross-provider browsing never
  resumes a foreign session in place — provider session IDs are not portable.
- **Refresh.** Filesystem scans on demand + 5-minute TTL (mirrors
  `PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS`); ACP probes cached 15 minutes on success, never on failure
  (`PROBE_SUCCESS_TTL_MS` in `provider-acp-registry/src/server/driver.ts`); a watcher on known
  roots can invalidate, but must be debounced and idle-throttled.
- **Security.** Read-only outside codeitlab-owned dirs; redact values that look like secrets
  (`env`/`headers` values never leave the server unless the user reveals them); refuse to follow
  symlinks out of a skill root (the Cursor scanner already dedups linked roots); cap file size and
  count per source; never execute a harness binary during a scan.

### Coverage gaps to resolve with the Lead

- Hermes `hermes acp` was verified to _start-check_, not to complete a full `session/new` turn from
  codeitlab. First integration test must do a real initialize + one prompt.
- DSH ACP launch string (`dsh --profile acp`) is documented but `dsh` is not on this machine's PATH;
  confirm the exact argv against the bundled runtime before wiring the instance default.
- Codex/Grok/OpenCode/Gemini/Pi/Cursor are not installed here; their launch/auth rows are
  source-derived and need one live smoke test each on the machine that owns them.
- ACP does not standardize skills; every non-native ACP agent's skills are invisible unless it has
  a filesystem root we know. That is a hard limit of the "skills union" feature and must be stated
  in the UI.

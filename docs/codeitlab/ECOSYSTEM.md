# Ecosystem integrations: OmniRoute, Graft, Ponytail, Caveman

Four external systems already run on this machine and are wired into Hermes by hand. codeitlab
must ship them as _built-in, auto-activated_ capabilities: the user never configures them and never
asks for them. This document records what each is, how it is launched today (verified), and the
concrete activation design.

Design rule shared by all four: **activation is server-side policy, injection is per-session
context, and every behavior has a settings override.** Nothing depends on the user remembering a
command, and nothing writes to `~/.hermes` or any other harness's config.

## 1. OmniRoute — OpenAI-compatible model router

### What it is

A self-hosted router that fronts many providers and exposes **virtual `auto/*` models** that pick a
real model by intent (coding / fast / reasoning / vision / cheap / chaos …). codeitlab treats it as
one more OpenAI-compatible provider, plus as the backing router for "auto-route" when the user does
not pick a harness.

### Verified state

| Fact                  | Evidence                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailnet endpoint      | `http://100.86.11.88:20128` — `GET /v1/models` → **HTTP 401** `{"error":{"message":"Authentication required","type":"invalid_api_key","code":"invalid_api_key"}}`                                         |
| Health endpoint       | `GET /health` → **HTTP 404**, returns a 218 KB Next.js app shell — i.e. the service is up and serves a web UI, but there is no `/health` route                                                            |
| Local forward         | `http://localhost:20128/v1` — connection refused (`HTTP 000`); the auxiliary routes in Hermes config point here, so the forward is currently down                                                         |
| Hermes provider block | `~/.hermes/config.yaml:7` — provider `omniroute`, `base_url: http://100.86.11.88:20128`, `discover_models: true`, `model: tokenharbor/deepseek-v4-flash:free`                                             |
| Default model         | `model.default: "auto/best-coding-fast"`, `model.provider: "omniroute"`, `model.api_mode: chat_completions`, `model.key_env: HERMES_CUSTOM_OMNIROUTE_API_KEY`                                             |
| Virtual model catalog | 45 entries under `providers.omniroute.models` (list below)                                                                                                                                                |
| Auxiliary usage       | `auxiliary.web_extract` and `auxiliary.goal_judge` both `base_url: http://localhost:20128/v1` (router as sub-model backend)                                                                               |
| DSH usage             | `~/.dsh/profiles/desktop/cordis.patch.yml` configures `llm-pi-ai` provider `omni` → `http://100.86.11.88:20128/v1`, models `auto/best-coding`, `auto/best-fast`, `auto/best-coding-fast`, `antigravity/*` |

`auto/*` catalog (45): `best-coding`, `best-reasoning`, `best-fast`, `best-vision`, `best-chat`,
`best-coding-fast`, `best-free`, `best-chaos`, `pro-coding`, `pro-reasoning`, `pro-vision`,
`pro-chat`, `pro-fast`, `coding`, `coding:fast`, `coding:cheap`, `coding:free`, `coding:pro`,
`coding:reliable`, `fast`, `chat`, `cheap`, `offline`, `smart`, `reasoning`, `reasoning:pro`,
`vision`, `multimodal`, `subscription`, `thrifty`, `chaos`, `claude-opus`, `claude-sonnet`,
`claude-haiku`, `glm`, `minimax`, `mimo`, `zai`, `gemma`, `llama`, `gemini`, `kimi`, `qwen`,
`deepseek`, `gpt`.

### How codeitlab auto-enables it

1. **Discovery.** On startup and on the provider-refresh cadence, probe the configured router
   base URL with the stored key: `GET /v1/models`. A 200 yields the real model list and overrides
   the static `auto/*` seed; a 401 marks the router "reachable, auth required" and surfaces one
   actionable row in Settings → Providers (never a crash, never a blocking boot).
2. **One provider instance, no user action.** Ship a default `omniroute` provider instance
   (`driverKind: "openai-compatible"` style instance as a sibling of `packages/provider-acp/` or as
   an `acpRegistry`-style local HTTP provider) pre-pointed at the tailnet URL, with the API key
   resolved from the environment (`OMNIROUTE_API_KEY`, else `HERMES_CUSTOM_OMNIROUTE_API_KEY`) or the
   OS keychain. The first boot with no key runs in "catalog-only" mode: `auto/*` models are listed
   and selectable, but a turn fails with a structured auth error that links to the settings row.
3. **Auto-route integration.** `auto/*` models are the default target of the boost layer's smart
   routing (see FEATURE-SPEC): `auto/best-coding-fast` is the default for coding turns,
   `auto/best-reasoning` for planning/review, `auto/best-fast` for title/summary text generation,
   `auto/best-vision` for image turns. The mapping is a setting table, not code.
4. **Per-session injection.** For providers that accept an OpenAI-compatible base URL (DSH via
   `llm-pi-ai`, OpenCode, Pi, Codex config), codeitlab can inject the router as a model source for
   that session without editing the harness's own config — the adapter receives the base URL/key in
   its launch environment. For ACP agents, model IDs come from the agent, so OmniRoute is exposed
   through the agent's own provider configuration instead; codeitlab only routes the _codeitlab_
   text-generation calls.
5. **Settings override.** `ecosystem.omniroute.enabled` (default true), `.baseUrl`,
   `.apiKeyEnv`/keychain ref, `.defaultAutoModel`, `.routeOverrides` (task class → model),
   `.probeIntervalMs`, `.allowLocalhostFallback`.
6. **Failure behavior.** Router down → keep the last catalog, mark stale, fall back to the next
   route in the boost policy; never silently switch a running turn to a different model.

## 2. Graft — repo context graph + MCP server

### What it is

`@nanonets/graft` builds a repo's context graph as linked markdown cards (one per file, exact
`file:line` spans) and serves it over MCP and CLI. It cuts the "read the whole repo" cost: the agent
asks the graph instead of grepping.

### Verified state

| Fact           | Evidence                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary         | `/opt/homebrew/bin/graft` → `../lib/node_modules/@nanonets/graft/dist/cli.js`                                                                                                                                    |
| Version        | `0.21.1`                                                                                                                                                                                                         |
| MCP command    | `graft mcp [dir]` — serves over **stdio**; tools: `graft_find_code`, `graft_trace_calls`, `graft_find_all`, `graft_file_api`, `graft_repo_map`, `graft_check_freshness`                                          |
| Build          | `graft build [dir]` (`$0`, no key) → `graft/` in the repo; `--deep` adds LLM concept map + per-symbol summaries                                                                                                  |
| Query          | `graft ask "<query>" [dir]`, `graft skeleton <file> [dir]`, `graft check [dir]` (staleness, CI), `graft stats`, `graft viz`                                                                                      |
| Config         | `--dir` (default `<repo>/graft`), `--provider`/`--model`/`--api-key`/`--base-url` (env `GRAFT_PROVIDER`/`GRAFT_MODEL`/`GRAFT_API_KEY`/`GRAFT_BASE_URL`)                                                          |
| Hermes wiring  | `~/.hermes/config.yaml:3347` — `mcp_servers.graft = { command: /opt/homebrew/bin/graft, args: [mcp], env: { DO_NOT_TRACK: "1" } }`                                                                               |
| Existing graph | `~/.hermes/skills/graft/INDEX.md` — a repo map for `hermes-agent` with 80 per-file wiring cards (78 with extracted symbols); cache at `~/.hermes/hermes-agent/graft/.cache/{extract,fingerprint,ask-index}.json` |
| Skill          | `~/.hermes/skills/graft/` — a bundle whose `INDEX.md` explains grep-the-graph usage and lists the MCP tool names                                                                                                 |

### How codeitlab auto-enables it

1. **Per-project MCP server.** Register `graft mcp <projectRoot>` as a codeitlab-managed stdio MCP
   server for every project (through the existing `McpProviderSessions`/adapter injection, and
   `AcpMcpStdioBridge` for stdio-only ACP agents). It is registered at session start, not on user
   request.
2. **Index lifecycle.** On project add / first agent turn, if `<projectRoot>/graft/` is missing or
   `graft check` reports stale, enqueue a background `graft build` job (the existing jobs
   infrastructure). `$0` mode by default; `--deep` only when the user enables
   `ecosystem.graft.deep` (it costs tokens). `graft check` runs as a pre-turn freshness probe with a
   short timeout and never blocks the turn — stale graph is reported, not fatal.
3. **Skill.** Ship the `graft` skill (the INDEX.md pattern) as a built-in codeitlab skill so every
   provider sees "prefer `graft ask` over grepping" in its skill list, plus the rule "MCP graft tools
   are only useful when `graft/` exists in cwd" (this is the real failure mode today: the Hermes
   memory even records "tools μόνο με graft/ στο cwd").
4. **Auto-activation policy.** Enabled when: project root is a git repo, repo size > threshold
   (e.g. > 200 files or > 20k LOC), and no `graft/` exclusion in settings. The policy injects one
   line into `appContext`: "Graft graph is available for this repo; use `graft_repo_map` /
   `graft_find_code` before broad file reads." No user request needed.
5. **Settings override.** `ecosystem.graft.enabled` (default true), `.mode: "auto"|"always"|"off"`,
   `.deep`, `.maxBuildMinutes`, `.excludeGlobs`, `.freshnessTtlMs`.
6. **Cost guard.** One build job per project at a time; cancel on project removal; never index
   `node_modules`/`.git`; cap graph size and fail soft.

## 3. Ponytail — always-on "lazy senior dev" policy pack

### What it is

Ponytail v5.1.1 is a cross-agent plugin that injects a terse, minimal-change engineering policy:
smallest complete change, no unrequested abstractions, scope check before writing, and a closing
line stating what was skipped and the risk. Modes: `off`, `lite`, `full` (default), `ultra`; plus a
`review` command mode.

### Verified state

| Fact               | Evidence                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install            | `~/.hermes/plugins/ponytail` (v5.1.1, MIT, author Dietrich Gebert)                                                                                                                                                                  |
| Manifest           | `plugin.yaml`: provides hooks `pre_llm_call`, `pre_gateway_dispatch`; commands `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`; the same six as skills                           |
| Hermes integration | `__init__.py` — Python plugin; `DEFAULT_MODE = "full"`, `RUNTIME_MODES = {off,lite,full,ultra}`, `CONFIG_MODES = RUNTIME_MODES ∪ {review}`, mode persisted in `~/.config/ponytail/config.json` (or `$XDG_CONFIG_HOME`, `%APPDATA%`) |
| Activation         | `hooks/ponytail-activate.js` runs on session start: writes `$CLAUDE_CONFIG_DIR/.ponytail-active`, emits the ruleset as hidden SessionStart context, nudges statusline setup; `hooks/ponytail-mode-tracker.js` on each prompt        |
| Cross-agent        | `claude-codex-hooks.json`, `copilot-hooks.json`, `cursor-hooks.json`, `qoder-hooks.json`; `.cursor/`, `.windsurf/`, `.kimi-plugin/`, `.qoder-plugin/`, `.opencode/`, `gemini-extension.json`, `pi-extension/`, `opencode.json`      |
| Ruleset            | `hooks/ponytail-instructions.js` builds the active-mode ruleset from `skills/ponytail/SKILL.md`, filtering the intensity table and worked examples by mode                                                                          |
| Skills             | `skills/{ponytail,ponytail-review,ponytail-audit,ponytail-debt,ponytail-gain,ponytail-help}/SKILL.md`                                                                                                                               |

### How codeitlab auto-enables it

1. **Policy pack, not plugin system.** codeitlab does not need a general plugin runtime to get this
   value. Implement it as a built-in _instruction pack_ in the server: a versioned ruleset (vendored
   from Ponytail's MIT-licensed `SKILL.md`, with attribution) rendered for the active mode, injected
   as developer instructions into every provider session.
2. **Injection points (per provider).** Codex: `CodexDeveloperInstructions.ts`; Claude: adapter
   system-prompt assembly; ACP: session instruction/system-prompt block; Cursor/Grok/OpenCode/Pi:
   their adapter's instruction channel. One `PolicyPackService` renders the pack; each adapter
   consumes the same rendered text so behavior cannot drift.
3. **Commands become slash commands.** `/ponytail`, `/ponytail-review`, `/ponytail-audit`,
   `/ponytail-debt`, `/ponytail-gain`, `/ponytail-help` are registered as codeitlab composer
   commands (the `ServerProviderSlashCommand` path) that inject the matching skill body. Mode switch
   is a command, and "stop ponytail"/"normal mode" clears it for the session.
4. **Auto-activation policy.** On by default at `full` for coding projects; `lite` for
   non-code/prose projects; `off` for security-sensitive review threads unless the user opts in
   (the "smallest change" bias can hide risk — the pack's own closing "what I skipped / risk" line
   mitigates but does not remove this). It is injected silently; the UI shows a small "policy
   active" chip in the composer with the mode, never a modal.
5. **Settings override.** `ecosystem.ponytail.enabled` (default true), `.mode: off|lite|full|ultra`
   (default full), `.perProject: {projectId → mode}`, `.commandsEnabled`, `.attribution`.
6. **Interaction with other packs.** Fixed composition order: identity/safety → Ponytail → Caveman
   → REA → user instructions. Later packs may add rules but must not contradict earlier safety
   rules. Dedupe identical lines across packs.

## 4. Caveman — always-on terseness hook

### What it is

A 30-line `pre_llm_call` hook (`~/.hermes/agent-hooks/caveman-lite.py`) that prepends a fixed rule:
answer first, kill ceremony, short words, 20-word sentences, payload verbatim, bounded tool-run
status, never perform the style, auto-clarity exceptions for security warnings/irreversible
actions/user confusion, stop on "stop caveman"/"normal mode". It reads the JSON payload on stdin and
emits `{"context": RULE}`.

### Verified state

| Fact         | Evidence                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| File         | `~/.hermes/agent-hooks/caveman-lite.py`, executable, 30 lines                                                               |
| Registration | `~/.hermes/config.yaml:3471` — `hooks.pre_llm_call: [{ command: …/caveman-lite.py, timeout: 10 }]`                          |
| Contract     | stdin JSON payload (ignored), stdout `{"context": "..."}`; the rule applies every turn                                      |
| Stop phrases | `"stop caveman"` / `"normal mode"`                                                                                          |
| Exceptions   | security warnings, irreversible actions, step order, user confusion, questions asked to the user — plain prose, then resume |

### How codeitlab auto-enables it

1. **Same pack mechanism as Ponytail.** Implement as `PolicyPackService` pack `terse` (vendored rule
   text, MIT-compatible — it is the user's own script, so codeitlab can adopt it directly with
   attribution to the user). No Python hook process: the rule is rendered server-side, which also
   removes the per-turn subprocess cost.
2. **Injection.** Appended after Ponytail so it can compress Ponytail's closing line but cannot
   delete its risk statement (explicit composition rule: packs may not remove lines from earlier
   packs).
3. **Auto-activation policy.** On by default only when the user has used terse mode before
   (migrated preference from `~/.hermes/config.yaml` on first import) or when the project is a
   personal repo; **off** by default for team/OSS repos and for threads whose first message is a
   security review. Rationale: terseness reduces reviewability, and the pack itself says so.
4. **Stop handling.** "stop caveman"/"normal mode"/"stop terse" clears the pack for the session;
   persisted as `ecosystem.terse.sessionOverrides[threadId]`.
5. **Settings override.** `ecosystem.terse.enabled`, `.mode: off|lite|full` (the script is already
   "lite" — expose one level only unless a fuller variant is authored), `.autoDetect`.

## Activation matrix (one screen)

| System    | Auto-enabled when                 | Injection channel                                              | User-visible control                    | Never does                                                |
| --------- | --------------------------------- | -------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| OmniRoute | always (catalog-only without key) | model routing + OpenAI-compatible base URL for text generation | Providers row + route table             | rewrite another harness's config; switch models mid-turn  |
| Graft     | git repo over size threshold      | MCP stdio server + skill + one appContext line                 | Ecosystem settings + per-project toggle | block a turn on a stale index; index node_modules         |
| Ponytail  | coding project, default `full`    | developer/system instructions per provider + slash commands    | composer chip + `/ponytail`             | claim safety; override provider safety rules              |
| Caveman   | opt-in/migrated preference        | developer/system instructions (after Ponytail)                 | `/normal-mode`, chip                    | apply to security warnings, irreversible steps, questions |

## Failure modes to design for

- **Duplicate context.** Ponytail + Caveman + REA + project AGENTS.md can stack. Cap the injected
  policy text (e.g. 4,000 tokens total), dedupe lines, and log the rendered pack per turn for
  debuggability.
- **Instruction conflicts.** Providers with their own system prompt (Claude, Codex) may weight
  their native prompt higher. Report "applied" only when the provider accepted the instruction
  channel; otherwise show "advisory" in the UI.
- **Silent ecosystem death.** Every integration needs a health row (last successful probe, last
  build, last injection) and a one-click "disable for this project".
- **Security.** Graft/OmniRoute keys come from keychain/env, never the repo. MCP servers spawned by
  codeitlab inherit a scrubbed environment; `DO_NOT_TRACK=1` is set for Graft, and the same
  telemetry-off posture should be default for every bundled MCP server.

## What actually shipped (v0.1.0)

The design above is the target. This section is the implemented subset, so nobody mistakes a
follow-up for a regression.

| System          | Shipped                                                                                                                                                                                                                                                                                  | Where                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Graft           | `graft --version` probe (10 s timeout, cached 60 s), `graft mcp` registration written to `<stateDir>/codeitlab/mcp/ecosystem.json` with `DO_NOT_TRACK=1`, `graft` skill seeded into `<stateDir>/codeitlab/skills/graft/SKILL.md`, and one conditional instruction line in the turn block | `apps/server/src/codeitlab/ecosystem/EcosystemService.ts`, `packages/codeitlab/src/ecosystem.ts` |
| Ponytail        | Vendored ruleset (modes off/lite/full/ultra, attribution kept), rendered into every turn after the policy block and before REA; skill seeded                                                                                                                                             | same, plus `renderEcosystemInstructions`                                                         |
| Caveman / terse | Vendored rule text (modes off/lite/full), **enabled by default** (`lite`) because the user asked for it always-on; rendered after Ponytail and cannot delete Ponytail's risk line                                                                                                        | same                                                                                             |
| Settings        | `settings.codeitlab.ecosystem.{graft,ponytail,terse}` with defaults decoding from `{}`                                                                                                                                                                                                   | `packages/codeitlab/src/settings.ts`                                                             |
| RPC             | `codeitlab.ecosystem.status` (read) and `codeitlab.ecosystem.install` (settings-write; seeds skills + MCP registration)                                                                                                                                                                  | `packages/contracts/src/rpc.ts`, `apps/server/src/codeitlab/rpcHandlers.ts`                      |
| UI              | `/settings/codeitlab/ecosystem` tab: per-integration cards, kind/mode/version chips, warnings, install/refresh, honest-limits note                                                                                                                                                       | `apps/web/src/components/codeitlab/CodeItLabEcosystemPage.tsx`                                   |

Verification: `vp test run src/codeitlab/ecosystem` → 14 tests across three files: pure
render/decision, status shape, install writes four files, a missing binary is a warning, and
thread overrides. The installed Graft on this machine reports `0.21.1` through the real
`ProcessRunner`.

Not shipped yet (tracked follow-ups, not hidden):

1. ~~Graft MCP servers are not injected into ACP sessions.~~ **Shipped.** The ACP runtime now reads
   `<stateDir>/codeitlab/mcp/*.json` at session start and merges every stdio server next to
   `cil-code` (`packages/provider-acp/src/server/acpMcpContext.ts`), gated by
   `settings.codeitlab.nexus.injectMcp` (default `true`). HTTP/SSE registrations, unreadable files,
   and servers whose command is not on PATH are skipped with a warning; the session still starts.
2. **Ponytail slash commands** (`/ponytail`, `/ponytail-review`, …) are not registered as composer
   commands yet; the policy text is injected every turn, so the behaviour ships without them.
3. ~~Per-thread opt-out~~ — shipped: a short message that is exactly "stop caveman" / "normal
   mode" / "stop terse" / "stop ponytail" persists `off` for that thread in
   `<stateDir>/codeitlab/ecosystem/threadOverrides.json`; "caveman mode" / "ponytail mode" clears
   it. The turn hook (`turnInjection.ts`) writes it before the context service renders, so the
   message that turns it off is itself un-affected by the packs. Only short control messages count;
   a normal sentence containing the phrase is ignored. `threadOverrides.test.ts` covers detection,
   persistence across restarts, and malformed files.
4. **Mobile** has no Ecosystem surface; the settings page is web/desktop only.
5. OmniRoute discovery is implemented in the routing service (`routing/OmniRoute.ts`); a dedicated
   provider instance is still configuration, not a shipped default.

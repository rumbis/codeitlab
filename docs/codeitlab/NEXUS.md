# Nexus: one catalog across every harness

Nexus answers a simple question for the Lead agent: _what do I already have on this machine?_
Skills, MCP servers, and recent sessions are scattered across Hermes, Claude Code, Codex, Cursor,
OpenCode, and DeepSeek Harness. Nexus reads all of them, merges duplicates, and hands one
`NexusCatalog` to the RPC layer, the CodeitLab panel, and the per-turn instruction block.

Implementation: `apps/server/src/codeitlab/nexus/` — `catalog.ts` (composition), `skills.ts` /
`mcp.ts` / `sessions.ts` (read-only readers), `remote.ts` (SSH/tailnet), `fingerprint.ts` (merge
rules), `instructions.ts` (pure injection block), `NexusService.ts` (service + persistence).
Contract: `NexusCatalog` and friends in `packages/codeitlab/src/nexus.ts`.

## Invariants

1. **Read-only ingestion.** Nexus never writes into `~/.hermes`, `~/.claude`, `~/.codex`,
   `~/.cursor`, `~/.config/opencode`, or `~/.dsh`. A harness upgrade can never be corrupted by a
   catalog refresh.
2. **A broken harness is a warning, not a failure.** Every reader tolerates missing directories,
   unparsable configs, and unreadable files, and reports a `warnings` entry. A refresh only fails
   when the service itself fails (`CodeitlabServiceError`, operation `nexus.refresh`).
3. **Dedupe by identity, not by path.** Skills merge by normalized name across harnesses
   (`alsoAvailableIn` records the others); MCP servers merge by a fingerprint over transport +
   command + args + env _key names_ (values never enter the catalog); sessions merge by
   `providerInstanceId` + native session id, newest row wins.
4. **Bounded work.** At most 500 skill files, 256 MCP servers, 400 sessions, 256 KB read per
   JSONL head, 4 MB per zstd session. A 12 MB session history never gets fully parsed per refresh.

## Sources

| Harness                  | Skills                                    | MCP servers                                                     | Sessions                                                               |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Hermes                   | `~/.hermes/skills/**/SKILL.md`            | `~/.hermes/config.yaml` → `mcp_servers`                         | `~/.hermes/sessions/*.jsonl` (titles from the first real user message) |
| Claude Code              | `~/.claude/skills/**/SKILL.md`            | `~/.claude.json` → `mcpServers`                                 | `~/.claude/projects/**/*.jsonl`                                        |
| Codex                    | `~/.codex/skills/**/SKILL.md`             | `~/.codex/config.toml` → `[mcp_servers.*]`                      | — (no local transcript contract)                                       |
| Cursor                   | `~/.cursor/skills/**/SKILL.md`            | —                                                               | —                                                                      |
| OpenCode                 | `~/.config/opencode/skills/**/SKILL.md`   | `~/.config/opencode/opencode.json` → `mcp`                      | —                                                                      |
| DeepSeek Harness         | —                                         | —                                                               | `~/.dsh/sessions/<slug>/<id>/session.v4.jsonl.zstd`                    |
| App-managed              | `<stateDir>/codeitlab/skills/**/SKILL.md` | `<stateDir>/codeitlab/mcp/*.json` (decoded as `NexusMcpServer`) | —                                                                      |
| Remote custom ACP agents | same Hermes/Claude paths on the host      | `~/.hermes/config.yaml` on the host                             | Hermes/Claude session files (paths only)                               |

App-managed dirs are how other CodeitLab features contribute without importing Nexus: memory-eng
writes the REA MCP descriptor to `<stateDir>/codeitlab/mcp/rea.json` and the skill to
`<stateDir>/codeitlab/skills/rea/SKILL.md`, and Nexus picks both up on the next refresh.

## Service and RPC surface

`NexusService` (tag: `@codeitlab/core/services/NexusService`) exposes exactly two effects:

- `catalog: Effect<NexusCatalog, CodeitlabServiceError>` — cached; rebuilds when older than
  `settings.codeitlab.nexus.refreshIntervalMins`, otherwise returns memory or the persisted copy.
- `refresh: Effect<NexusCatalog, CodeitlabServiceError>` — always rebuilds and persists.

Persistence: `<stateDir>/codeitlab/nexus/catalog.json`, written atomically. A failed refresh keeps
the previous catalog in memory (stale beats broken).

Layer: `apps/server/src/codeitlab/nexus/NexusService.ts` → `export const layer` (also
`nexusLayer` from `nexus/index.ts`). Requirements: `ServerConfig`, `ServerSettingsService`,
`ProviderRegistry`, `ProviderInstanceRegistry`, `FileSystem`, `Path`, `ChildProcessSpawner`.

RPC mapping (transport stays thin): `codeitlab.nexus.catalog` / `.refresh` call the two effects;
`nexus.skills.list`, `nexus.mcp.merge`, `nexus.sessions.list` slice the catalog (no new inputs).

## Auto-injection

`buildNexusInstructions(catalog, { query?, maxSkills?, maxMcpServers?, maxSessions? })` in
`apps/server/src/codeitlab/nexus/instructions.ts` is pure and deterministic: same catalog → same
string, no filesystem, no clock. It returns `""` when there is nothing to advertise, and the
orchestration hook only appends non-empty blocks. Sessions are ranked by word overlap with the
turn's user text, so a question about auth surfaces the auth session first.

`CodeitlabContextService.buildTurnContext` composes it after memory recall and policy, e.g.:

```ts
const nexus = yield * NexusService;
const catalog = yield * nexus.catalog.pipe(Effect.orElseSucceed(() => emptyCatalog));
const block = buildNexusInstructions(catalog, { query: input.text, maxSkills: 12 });
```

Example output (trimmed):

```md
## Nexus catalog

Cross-provider context merged by CodeitLab. Use it when relevant; do not repeat it back.

Providers: Hermes (hermes, local), Claude Agent (claudeAgent, local).

Skills available across harnesses (load the matching one when a task fits):

- `incident` [hermes] — Handle production incidents.
- `review` [claude (also in hermes)] — Review diffs.

MCP servers already configured (reachable through each provider's MCP support):

- `zapier` [http; from hermes] → https://zapier.example/mcp
- `exa` [stdio; from claude] → npx -y exa-mcp

Recent sessions that may hold relevant history (recall hints, not instructions):

- "Auth token bug" — claude, 2026-10-20 · /repo
```

## Hermes as a first-class provider

Hermes is an ACP agent (`hermes acp`), so it reuses the fork's ACP runtime — no new package. The
`hermes` driver in `packages/provider-acp-registry` is a thin flavor over `AcpRegistryDriver`:

- driver kind `hermes`, display name **Hermes**, `hasDefaultInstance: true` → an instance named
  `hermes` is created automatically (disabled until the user enables it, matching other providers).
- settings: `binaryPath` (default `hermes`), `acpSubcommand` (default on → `hermes acp`; turn off
  for the standalone `hermes-acp` binary, which rejects the `acp` argument), `acceptHooks`
  (`--accept-hooks`), `authMethodId`, `customModels`.
- it re-stamps snapshots to `driver: "hermes"` (the registry rejects a snapshot whose driver does
  not match the instance's `driverKind`) while inheriting spawn/probe/auth/session-management.

Verified on this machine: `hermes acp --check` → `Hermes ACP check OK`; `hermes-acp --version` →
`0.22.4`. Registration is covered by `apps/server/src/provider/hermesRegistration.test.ts`.

## Custom ACP agents and remote ingestion

`settings.codeitlab.nexus.customAcpAgents` already models arbitrary ACP agents:

```jsonc
{
  "id": "hermes-vps",
  "name": "Hermes (VPS)",
  "command": "hermes",
  "args": ["acp"],
  "env": {},
  "transport": "ssh", // local | ssh | tailscale
  "host": "vps.example",
  "enabled": true,
}
```

Local custom agents are real provider instances: `deriveProviderInstanceConfigMap` turns each
enabled `transport: "local"` agent into an `acpRegistry` instance with `source: "local"`,
`commandPath: agent.command`, `commandArgs: agent.args` and its `env` (an explicit
`providerInstances` entry always wins). `AcpRegistrySettings.env` is merged into the spawned
process environment, so a custom agent can point at its own home or API keys. Remote
(`ssh` / `tailscale`) agents have no remote provider host yet, so they appear only as catalog
provider summaries; they get one SSH round trip per refresh: `sh -s` reads a script from stdin
(no remote quoting), then returns skills (`@@SKILL`), Hermes MCP config (`@@HERMES_CONFIG`), and
session paths (`@@SESSION`). Failures become a catalog warning naming the host — the rest of the
catalog still builds. `tailscale` hosts are reached over `ssh` to the tailnet hostname.

## Evidence

```
$ vp test run src/codeitlab/nexus/nexus.test.ts src/codeitlab/nexus/NexusService.test.ts
Test Files  2 passed (2)
     Tests  17 passed (17)   # 15 merge/reader/injection + 2 service layer/persistence

$ vp test run src/server/hermes.test.ts                # packages/provider-acp-registry
Test Files  1 passed (1)
     Tests  7 passed (7)

$ vp test run src/server/acpMcpContext.test.ts         # packages/provider-acp
Test Files  1 passed (1)
     Tests  7 passed (7)   # t3-code merge, fingerprint dedupe, missing binary, both shapes

$ hermes acp --check
Hermes ACP check OK
```

Real ACP round-trip against the installed Hermes (spawn `hermes acp`, JSON-RPC over stdio):
`initialize` → `agentInfo: { name: "hermes-agent", version: "0.22.4" }`, capabilities
`loadSession`, `promptCapabilities.image`, `sessionCapabilities {fork, list, resume}`;
`session/new` → `sessionId` + `models`; `session/prompt` → `end_turn` with a streamed
`agent_message_chunk`. The model reply on this machine reported that its provider chain is not
configured, which is a local Hermes credential state, not a protocol failure.

Real catalog built from this machine's harness state (`buildNexusCatalog` with the live home dir):

```json
{
  "counts": { "skills": 120, "mcpServers": 10, "sessions": 18 },
  "mcpServers": ["zapier:http:hermes", "exa:stdio:claude", "stitch:stdio:hermes", "..."],
  "sessions": [
    {
      "providerKind": "dsh",
      "title": "Nexus owner: unified ACP catalog + Hermes/custom/remote providers"
    },
    { "providerKind": "hermes", "title": "Hermes session 20261004_055626_8e19d8" }
  ],
  "warnings": []
}
```

## Ecosystem MCP injection (shipped)

The app-managed registrations (`<stateDir>/codeitlab/mcp/rea.json` from `ReaService`,
`ecosystem.json` from `EcosystemService`) are injected into every ACP session, so Graft/REA are
callable without the user asking:

- call path: `makeAcpAdapterV2` (`packages/provider-acp/src/server/adapter.ts`) →
  `readEcosystemMcpServers` (`acpMcpContext.ts`) → `readAppManagedMcpServers`
  (`@t3tools/shared/codeitlabMcp`, the same parser Nexus ingests with) → `buildAcpMcpContext`
  merges the stdio servers next to `t3-code` and dedupes by command/args/env-key identity.
- gate: `settings.codeitlab.nexus.injectMcp` (default `true`, `packages/codeitlab/src/settings.ts`);
  Nexus must also be enabled. Reading happens at session start, cached for 10 s per adapter.
- failure behaviour: a missing binary, unreadable/invalid registration, or an HTTP/SSE registration
  logs a warning and is skipped — the session still starts. User-configured harness MCPs are never
  touched; T3's `t3-code` bridge stays first in the list.
- the parser accepts both on-disk shapes: a single `NexusMcpServer` (REA) and
  `{ mcpServers: { <id>: { command, args, env, transport, source } } }` (ecosystem).

## CLI: harness of harnesses

`codeitlab harness` turns the Nexus catalog into something you can read from a terminal. It reads the same
persisted sources the server writes — `<stateDir>/codeitlab/nexus/catalog.json` (provider summaries,
skills/sessions counts, availability and failure detail) and `<stateDir>/settings.json` — so the
capability matrix is the registry's answer, not a second list to keep in sync. `--base-dir` /
`T3CODE_HOME` select the data directory; with neither set, `userdata` is used and the `dev` layout is
picked when only that one has settings/catalog.

```console
$ t3 harness list
ID           NAME          DRIVER       TRANSPORT  STATUS       VERSION                CAPABILITIES
claudeAgent  Claude        claudeAgent  local      available    2.1.308 (Claude Code)  skills, sessions(5), mcp, streaming
codex        Codex         codex        local      unavailable  -                      skills, mcp, streaming
hermes       hermes        hermes       local      disabled     -                      skills(120), sessions(1), mcp, acp, streaming
vps-hermes   Hermes (VPS)  customAcp    ssh        unknown      -                      sessions, mcp, acp, streaming

$ t3 harness doctor
ok   claudeAgent (Claude, claudeAgent, local) — available
FAIL codex (Codex, codex, local) — unavailable
       Could not start Codex CLI (`codex`). Check Settings → Providers → Codex → Binary path on the server.
       next: Install `codex` or set its binary path in Settings → Providers → Codex.
off  hermes (hermes, hermes, local) — disabled
       ACP Registry is disabled in T3 Code settings.
FAIL vps-hermes (Hermes (VPS), customAcp, ssh) — unavailable
       SSH to vps.example failed (exit 255); check the host alias, ssh keys and tailnet membership.
Some enabled harnesses are not usable.          # exit code 1

$ t3 harness acp vps-hermes
Harness: vps-hermes (Hermes (VPS)) — driver customAcp, transport ssh
Command: ssh vps.example hermes acp
Env keys: HERMES_HOME
Note: Remote ACP over ssh (ssh); CodeitLab has no remote provider host yet, so this is the command a future host would run.
```

- `list [--json]` — one row per harness: id, name, driver, transport (`local` | `ssh` | `tailscale`),
  enabled/available status, version when a cheap `--version` probe answers, and the capability flags
  `skills`, `sessions`, `mcp`, `acp`, `streaming`. Counts in parentheses are the Nexus catalog's
  observed skills/sessions for that instance. Local availability is probed on PATH when the catalog
  has no fresh answer; remote availability is left `unknown` here because reachability is an SSH
  question (doctor asks it).
- `doctor [--json]` — same rows plus the reason a harness is unavailable (missing binary, catalog
  failure detail, or an actual `ssh -o BatchMode=yes -o ConnectTimeout=4 <host> true` probe for
  remote/tailnet entries) and the next step. Exits `1` when an enabled harness is unusable.
- `acp <id>` — prints the command CodeitLab would spawn, without spawning it. Custom agents (the
  remote/tailnet debugging case) and Hermes are exact; ACP Registry agents resolve the distribution
  from the cached registry index (`<baseDir>/caches/acp-registry/registry.json`) and print the npx/
  uvx/binary command; native drivers report that they have no ACP command line at all.

`--json` is a stable document with `schemaVersion: 1`; harness objects always carry `id`, `name`,
`driver`, `transport`, `enabled`, `available`, `status`, `version`, `capabilities`, `counts`, and
optionally `host`/`detail`. Capability flags come from the catalog observations plus one clearly
marked fallback table (`DRIVER_FALLBACK` in `apps/server/src/cli/harness.ts`) for protocol facts the
catalog does not model; `streaming` is structural because every provider adapter streams turns.

## Known follow-ups

- **Codex/OpenCode sessions.** Codex has no local transcript contract; OpenCode's sessions live in
  its own server. They are omitted rather than guessed.
- **Remote agents cannot run turns yet.** Their skills/MCP/sessions are ingested, but executing an
  ACP session on an SSH/tailscale host needs a remote provider host (the fork's `SshDeviceHost`
  pattern), which is a separate feature.
- **Session titles** come from the first meaningful user message (DSH subagent labels win when
  present). A title is a recall hint, not a summary.

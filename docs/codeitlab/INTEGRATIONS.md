# Whitelabel integrations (Shorts, Crew, Search)

CodeitLab fronts three self-hostable open-source tools as its own surfaces. The UI, the names, the
marks and the settings language are ours; the engines stay separate software that you run and that
keeps its own license and its own repository. Nothing is bundled, nothing is installed silently, and
every page says which engine is behind it.

| CodeitLab surface | Engine                                              | What it does                                                                                           | License                                                             |
| ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Shorts**        | [OpenShorts](https://github.com/mutonby/openshorts) | Turns long videos into vertical 9:16 clips with AI moment detection, reframing and subtitles           | MIT (the `cloud/` directory is commercial and not part of the core) |
| **Crew**          | [Rakazo](https://github.com/elie222/rakazo)         | Self-hosted persistent teammate bots with memory, routines and their own computers                     | Apache-2.0                                                          |
| **Search**        | [ModSearch](https://github.com/liustack/modsearch)  | Web and X search plus page fetch for models that have none, with engine failover and no API key needed | MIT                                                                 |

## How each one is wired

**Shorts — full integration.** OpenShorts exposes a REST API and an MCP server. CodeitLab probes
`/health` and, when the engine answers, registers `http://<base>/mcp` (HTTP transport) into
`<stateDir>/codeitlab/mcp/integrations.json`. The Nexus catalog reads that directory, so an agent in
a turn gets the OpenShorts tools — `process_video`, `get_job_status`, `list_clips`, `publish_clip`
and the rest — without the user pasting a URL into a prompt. Self-hosted OpenShorts has **no
authentication**: keep it on loopback or a tailnet, never on a public address.

**Crew — status and link-out.** Rakazo is a peer agent stack, not a tool server: it has no MCP
server (it is an MCP _client_), no ACP, and its API is an auth-gated oRPC surface with no public
token. So the Crew page probes the API health endpoint (port `3100`; the web port `5173` does not
serve `/health`) and opens the web UI. The honest integration is the reverse direction: inside
Rakazo you can point an integration at a CodeitLab MCP endpoint. Do not expect CodeitLab to drive
Rakazo bots — it cannot, and pretending otherwise would be the kind of lie this fork exists to
avoid.

**Search — skill, not a server.** ModSearch ships as a CLI plus an agent skill, with no MCP server.
Enabling the Search surface writes a `search` skill into `<stateDir>/codeitlab/skills/search/SKILL.md`
that tells the agent how to call it (`npx -y --package @liustack/modsearch@5.10.10 modsearch -q "…"`),
so the agent uses it when a question needs current facts. The keyless default engine (Firecrawl) was
verified live during integration research: a real query returned 8 results in 0.8 s with no API key.

## Self-hosting the engines

Shorts:

```bash
git clone https://github.com/mutonby/openshorts && cd openshorts
docker compose up --build          # API on :8000, dashboard on :5175
```

Set the CodeitLab base URL to `http://127.0.0.1:8000` (the default). Point `LLM_BASE_URL` at a local
OpenAI-compatible model if you do not want to use Google Gemini for the moment picker.

Crew:

```bash
mkdir -p rakazo && cd rakazo
curl -fsSLO https://raw.githubusercontent.com/elie222/rakazo/main/infra/compose/install-images.sh
bash install-images.sh             # web on :5173, API on :3100
```

Set the CodeitLab base URL to `http://127.0.0.1:5173` (the default) so the Open action lands on the
UI; health is probed on `:3100` automatically.

Search: nothing to run. Enabling it writes the skill; the CLI downloads on first use.

## Settings

`Settings → CodeitLab → Shorts / Crew / Search`, or the RPCs directly:

| RPC                           | Scope              | Payload                                          |
| ----------------------------- | ------------------ | ------------------------------------------------ |
| `codeitlab.integrations.list` | orchestration read | `{}`                                             |
| `codeitlab.integrations.set`  | settings write     | `{ patch: { id, enabled?, baseUrl?, apiKey? } }` |

Settings live in `codeitlab.integrations` in the server settings file. `apiKey` is accepted for
engines that want one (hosted OpenShorts uses `Bearer osk_…`) and is never echoed back in the list
response.

## Not shipped yet

- No bundled engine, no Docker orchestration from inside the app: you run the engine, CodeitLab
  configures and probes it.
- Rakazo's bot webhook (`POST /api/v1/bots/:botId/webhook`) is not driven by CodeitLab; its secret is
  configured in Rakazo's own UI.
- ModSearch runs through its CLI on the server host; a sandboxed per-turn exec policy is a separate
  decision and is not part of this surface.
- No third-party logos: the marks on these pages are original CodeitLab artwork. Attribution is text
  and a link, not a trademark.

## Shorts job flow

The Shorts page can submit a clip job, not just probe the engine:

| RPC                                       | Scope              | Payload                                                                    | Returns                                                                      |
| ----------------------------------------- | ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `codeitlab.integrations.shorts.createJob` | settings write     | `{ url, acknowledged, targetClips?, captions?, autoHook?, outputFormat? }` | `{ jobId, state, partial? }`                                                 |
| `codeitlab.integrations.shorts.jobStatus` | orchestration read | `{ jobId }`                                                                | `{ jobId, state, engineStatus?, queuePosition?, logs[], clips[], partial? }` |

`state` is normalised to `queued | processing | completed | failed | unknown` — an engine status we
do not recognise becomes `unknown` instead of being reported as finished. Clips carry `title`,
`startSeconds`, `endSeconds`, a `videoUrl` made absolute against the configured base URL, and the
per-platform copy fields when the engine returns them.

`acknowledged` is enforced locally: without a rights confirmation the request never reaches the
engine (which would reject it anyway with a 400). `targetClips` is clamped to 1–12 (default 3).

What the page does not do: it does not start/stop the engine's Docker stack, does not upload local
files (URL ingest only), and does not publish clips to social platforms — those stay in the
engine's own dashboard, opened from the same card.

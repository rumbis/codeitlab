# ACP free tiers: which registry agents can run at zero cost

CodeItLab can install all 43 agents in the official
[ACP registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json).
This page answers one question for each of them: **can a user actually run this agent's
models at zero cost, without entering a card?**

The machine-readable block at the bottom of this page is the source of truth for the
product: the Agents page keeps a `free: true` entry available and disables or hides the
rest. Research date: **2026-10-24**, checked against each vendor's own pricing, docs or
repository page (the `sourceUrl` in every entry).

## How an agent earns "free"

| Verdict   | Meaning                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| `free`    | Usable at zero cost without a card: a free plan with included usage, or free model endpoints/promotions.       |
| `trial`   | Only time-boxed credits or a trial; a paid plan is required afterwards.                                        |
| `byo-key` | The app itself is free (usually open source), but normal use needs your own paid provider key or subscription. |
| `paid`    | The vendor requires a paid plan to use the agent at all.                                                       |
| `unknown` | No official page could be reached or found; deliberately not guessed.                                          |

Two honesty rules apply throughout:

- **Open source is not free usage.** An Apache-2.0 agent that needs an OpenAI key is
  `byo-key`, not `free`; the `openSource` flag records the licence separately.
- **Free model _promotions_ count as free models** (Cline, Qoder, OpenCode Zen), because
  the user pays nothing while they last. Time-boxed _credits_ are only a trial.

## Counts

**Free: 16 · Trial: 4 · BYO key: 18 · Paid: 4 · Unknown: 1** — 43 agents total.

## Summary table (sorted by verdict, free first)

| Agent                                  | Verdict | Free models | Free plan | BYO key | Evidence                                                                                                                                     |
| -------------------------------------- | ------- | ----------- | --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cline (`cline`)                        | Free    | yes         | no        | yes     | Cline runs rotating free-model promotions for any Cline account, tagged FREE in the CLI model selector.                                      |
| Codebuddy Code (`codebuddy-code`)      | Free    | no          | yes       | no      | Tencent's pricing page advertises a limited-time free Personal edition of CodeBuddy alongside the paid editions.                             |
| Codex (`codex-acp`)                    | Free    | no          | yes       | yes     | ChatGPT Free includes limited Codex access; paid plans only expand the Codex usage allowance.                                                |
| Copilot (`github-copilot-cli`)         | Free    | no          | yes       | no      | Copilot Free is $0 with an AI-credit allowance and limited agents, and every Copilot plan includes Copilot CLI.                              |
| Cursor (`cursor`)                      | Free    | no          | yes       | no      | Cursor's Free plan is $0/month and includes limited agent requests and limited chat requests.                                                |
| Devin (`devin`)                        | Free    | no          | yes       | no      | Devin's Free $0 plan includes a light agent quota, limited model availability and unlimited inline/Tab edits.                                |
| Gemini CLI (`gemini`)                  | Free    | no          | yes       | yes     | Gemini CLI documents a free tier of 1,000 model requests/day with Google sign-in (250/day with a free API key).                              |
| Google Antigravity (`antigravity-acp`) | Free    | no          | yes       | no      | Antigravity's individual plan is $0/month and includes access to agent models with basic weekly rate limits.                                 |
| Grok Build (`grok-build`)              | Free    | no          | yes       | no      | xAI's Free plan is $0/month with limited agent requests and limited Grok Build access.                                                       |
| Junie (`junie`)                        | Free    | yes         | yes       | yes     | Junie Lite is a free model, always on, in every JetBrains account — no trial and no card required.                                           |
| Kilo (`kilo`)                          | Free    | yes         | yes       | yes     | Kilo's $0 plan routes Auto Free through Kilo Gateway to free models, with BYOK and local models as fallbacks.                                |
| Mistral Vibe (`mistral-vibe`)          | Free    | no          | yes       | yes     | Mistral's Free plan includes limited Vibe coding sessions; all-day CLI coding is a Pro feature.                                              |
| OpenCode (`opencode`)                  | Free    | yes         | no        | yes     | OpenCode Zen lists free-tier chat models (glm-5.3-flash-free, deepseek-v4.1-flash-free, nemotron, mimo) for OpenCode clients.                |
| OpenCode V2 (`opencode-v2`)            | Free    | yes         | no        | yes     | V2 is the same OpenCode client and shares the Zen free-tier model list; the V2 docs do not restate it.                                       |
| Qoder CLI (`qoder`)                    | Free    | yes         | yes       | yes     | Qoder's Free plan includes limited messages, BYOK, a 2-week Pro trial and a claimable 100 credits/day, with limited-time free models.        |
| siGit Code (`sigit`)                   | Free    | yes         | no        | yes     | No API key is required to start: first launch downloads a GGUF model and runs it on-device through Onde.                                     |
| Auggie CLI (`auggie`)                  | Trial   | no          | no        | no      | Augment's pricing lists only paid plans (Standard $20/mo, Business $100/mo, Enterprise) and the FAQ only references trial usage terms.       |
| Bob (`bob`)                            | Trial   | no          | no        | no      | IBM Bob offers a free 30-day trial with 50 Bobcoins; a subscription is required to continue.                                                 |
| Cortex Code (`cortex-code`)            | Trial   | no          | no        | no      | Snowflake offers a dedicated free CoCo CLI trial; standard Snowflake trial accounts do not include CoCo CLI.                                 |
| Nova (`nova`)                          | Trial   | no          | no        | no      | Every Nova plan starts with a 7-day free trial, after which per-seat pricing applies.                                                        |
| Amp (`amp-acp`)                        | BYO key | no          | no        | yes     | Amp's Hobby tier is $0 but includes no hosted usage: you bring your own keys or use your ChatGPT/Claude subscription.                        |
| Autohand Code (`autohand`)             | BYO key | no          | no        | yes     | Free Apache-2.0 ACP agent whose setup connects your own provider credentials or a local model.                                               |
| crow-cli (`crow-cli`)                  | BYO key | no          | no        | yes     | Requires an API key for an OpenAI-compatible provider (OpenRouter, OpenAI or your own endpoint) configured by crow-cli init.                 |
| DeepAgents (`deepagents`)              | BYO key | no          | no        | yes     | MIT harness with no bundled inference; every run is bound to a model provider you supply a key for.                                          |
| DimCode (`dimcode`)                    | BYO key | no          | no        | yes     | DimCode is bring-your-own-model across 30+ providers, local Ollama/LM Studio and custom endpoints; its Coding Plan is listed as coming soon. |
| Dirac (`dirac`)                        | BYO key | no          | no        | yes     | Apache-2.0 agent supporting dozens of providers; you bring the models and credentials you already pay for.                                   |
| fast-agent (`fast-agent`)              | BYO key | no          | no        | yes     | Apache-2.0 multi-provider agent framework; providers are configured with your own API keys.                                                  |
| GLM Agent (`glm-acp-agent`)            | BYO key | no          | no        | yes     | Built for the Z.AI GLM Coding Plan endpoint only, so it needs a paid Coding Plan API key rather than free GLM promos.                        |
| goose (`goose`)                        | BYO key | no          | no        | yes     | Apache-2.0 agent that runs with your own API keys or existing Claude, ChatGPT or Gemini subscriptions.                                       |
| Harn (`harn`)                          | BYO key | no          | no        | yes     | Apache-2.0 runtime where hosted models need the provider's credentials and local models run offline.                                         |
| Kimchi (`kimchi`)                      | BYO key | no          | no        | yes     | Hosted plans start at $20/mo; the free Open Source plan is CLI-only and brings your own inference.                                           |
| Kimi CLI (`kimi`)                      | BYO key | no          | no        | yes     | Kimi Code requires a paid Kimi plan or API key, and the MIT CLI can also use any BYO provider key.                                           |
| Minion Code (`minion-code`)            | BYO key | no          | no        | yes     | AGPL-3.0 agent that needs an LLM configured (provider API key or OpenAI-compatible endpoint) before it can run.                              |
| pi ACP (`pi-acp`)                      | BYO key | no          | no        | yes     | MIT agent; run /login to connect a subscription or API key — there is no free hosted tier.                                                   |
| Poolside (`poolside`)                  | BYO key | no          | no        | yes     | pool runs on your own Poolside API key, OpenRouter, Ollama or any OpenAI-compatible endpoint; no free Poolside-hosted tier is published.     |
| Qwen Code (`qwen-code`)                | BYO key | no          | no        | yes     | The Qwen OAuth free tier was discontinued on 2026-04-15; use an API key, Coding Plan or third-party provider instead.                        |
| Stakpak (`stakpak`)                    | BYO key | no          | no        | yes     | Stakpak's always-free Open Source plan is BYO keys or local models; hosted plans start at $15/mo.                                            |
| VT Code (`vtcode`)                     | BYO key | no          | no        | yes     | MIT/Apache-2.0 agent; add your own provider credentials with vtcode secret add or a supported provider login.                                |
| Agoragentic (`agoragentic-acp`)        | Paid    | no          | no        | no      | Public catalog discovery is $0, but every capability invocation is billed per call in USDC on Base.                                          |
| Claude Agent (`claude-acp`)            | Paid    | no          | no        | yes     | Claude Code is included only from the Pro plan ($20/mo); the free Claude plan does not include it.                                           |
| Factory Droid (`factory-droid`)        | Paid    | no          | no        | no      | Factory's individual plans start at Pro $20/mo; the free Droid Core model pool only applies after paid Standard Usage runs out.              |
| MiniMax Code (`minimax-code`)          | Paid    | no          | no        | no      | MiniMax Code requires signing in with an M Plan subscription; the published pricing is paid plans and per-token rates.                       |
| Corust Agent (`corust-agent`)          | Unknown | no          | no        | no      | corust.ai did not resolve and the release repo ships no README or pricing, so auth and cost could not be verified.                           |

## How CodeItLab should use this

1. **Availability gate.** Render only entries whose `verdict` is `free` as installable
   "no card needed" agents. `trial` entries can stay visible behind a "Trial — card
   required afterwards" badge. `byo-key` entries should be shown as "Bring your own key"
   and can stay installable only if the app already ships the provider-key flow for that
   agent. `paid` and `unknown` entries should be disabled or hidden from the default
   catalog.
2. **Never infer free from open source.** `openSource: true` with `verdict: byo-key`
   means the user still needs a paid model provider. Keep the licence badge and the
   availability badge separate in the UI.
3. **Re-verify before shipping a release.** Free tiers and promotions rotate (Cline's free
   models, CodeBuddy's limited-time free edition, OpenCode's Zen free list). Re-run the
   checks in the "Maintenance" section and bump the research date rather than trusting a
   stale note.
4. **Fail closed on `unknown`.** Corust Agent could not be verified; do not enable it by
   default just because the registry lists it.
5. **Region + auth still apply.** Free says nothing about sign-in (see
   `docs/codeitlab/ACP-SIGN-IN.md`) or regional availability (see
   `docs/codeitlab/ACP-REGION-AVAILABILITY.md`); both gates run on top of this one.
6. **Reconcile with the existing catalog.** `docs/codeitlab/FREEMIUM-AGENTS.md` and
   `apps/web/src/codeitlab/freemiumAgents.ts` use a looser "free to start" rule that also
   counts open-source BYO-key agents. Under this page's stricter rule those entries are
   `byo-key`, not `free`. When the gate ships, migrate the catalog to read this JSON block
   so one definition drives both the UI and the docs.

## Maintenance

The JSON block is generated by hand from the research notes; to refresh it, re-check each
`sourceUrl`, update `evidence`/`confidence`, and keep exactly one entry per registry id.
The verification snippet used for this page:

```python
import json, urllib.request
from collections import Counter

doc = open("docs/codeitlab/ACP-FREE-TIERS.md", encoding="utf-8").read()
# The JSON block starts after the "Machine-readable data" heading.
block = doc.split("## Machine-readable data", 1)[1].split("json", 1)[1]
block = block[block.index("["): block.rindex("]") + 1]
entries = json.loads(block)

registry = json.load(urllib.request.urlopen(
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"))
reg_ids = {a["id"] for a in registry["agents"]}
ids = [e["id"] for e in entries]
assert len(ids) == len(set(ids)) == len(reg_ids), (len(ids), len(set(ids)), len(reg_ids))
assert set(ids) == reg_ids, (set(ids) ^ reg_ids)
print(Counter(e["verdict"] for e in entries))
```

## Unverified / caveats

- **Corust Agent** — `corust.ai` did not resolve and its public release repository has no
  README or pricing; `unknown`, `unverified`.
- **Codebuddy Code** — the pricing page is a client-rendered SPA; the limited-time free
  Personal edition was verified from the page's own title/metadata, not the rendered
  pricing table (`partial`).
- **Gemini CLI** — Google's docs still list a free tier (1,000 requests/day), but the
  in-app sign-in matrix shows ACP sign-in rejected for individual accounts migrating to
  Antigravity (`partial`). Treat Antigravity as the working free Google path.
- **Auggie / Factory / MiniMax / Poolside / DimCode / Minion Code** — no free tier is
  published; notes say trial/paid/BYO based on the vendor's own pages, confidence
  `partial` where the page does not spell out the exact allowance.

## Machine-readable data

```json
[
  {
    "id": "antigravity-acp",
    "name": "Google Antigravity",
    "vendor": "Google",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": false,
    "openSource": false,
    "verdict": "free",
    "evidence": "Antigravity's individual plan is $0/month and includes access to agent models with basic weekly rate limits.",
    "sourceUrl": "https://antigravity.google/pricing",
    "confidence": "verified"
  },
  {
    "id": "cline",
    "name": "Cline",
    "vendor": "Cline",
    "freeModels": true,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "free",
    "evidence": "Cline runs rotating free-model promotions for any Cline account, tagged FREE in the CLI model selector.",
    "sourceUrl": "https://docs.cline.bot/getting-started/free-models",
    "confidence": "verified"
  },
  {
    "id": "codebuddy-code",
    "name": "Codebuddy Code",
    "vendor": "Tencent Cloud",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": false,
    "openSource": false,
    "verdict": "free",
    "evidence": "Tencent's pricing page advertises a limited-time free Personal edition of CodeBuddy alongside the paid editions.",
    "sourceUrl": "https://www.codebuddy.cn/pricing",
    "confidence": "partial"
  },
  {
    "id": "codex-acp",
    "name": "Codex",
    "vendor": "OpenAI",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "free",
    "evidence": "ChatGPT Free includes limited Codex access; paid plans only expand the Codex usage allowance.",
    "sourceUrl": "https://chatgpt.com/pricing",
    "confidence": "verified"
  },
  {
    "id": "cursor",
    "name": "Cursor",
    "vendor": "Cursor (Anysphere)",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": false,
    "openSource": false,
    "verdict": "free",
    "evidence": "Cursor's Free plan is $0/month and includes limited agent requests and limited chat requests.",
    "sourceUrl": "https://cursor.com/pricing",
    "confidence": "verified"
  },
  {
    "id": "devin",
    "name": "Devin",
    "vendor": "Cognition",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": false,
    "openSource": false,
    "verdict": "free",
    "evidence": "Devin's Free $0 plan includes a light agent quota, limited model availability and unlimited inline/Tab edits.",
    "sourceUrl": "https://devin.ai/pricing",
    "confidence": "verified"
  },
  {
    "id": "gemini",
    "name": "Gemini CLI",
    "vendor": "Google",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "free",
    "evidence": "Gemini CLI documents a free tier of 1,000 model requests/day with Google sign-in (250/day with a free API key).",
    "sourceUrl": "https://geminicli.com/docs/resources/quota-and-pricing",
    "confidence": "partial"
  },
  {
    "id": "github-copilot-cli",
    "name": "Copilot",
    "vendor": "GitHub",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": false,
    "openSource": false,
    "verdict": "free",
    "evidence": "Copilot Free is $0 with an AI-credit allowance and limited agents, and every Copilot plan includes Copilot CLI.",
    "sourceUrl": "https://docs.github.com/en/copilot/get-started/plans",
    "confidence": "verified"
  },
  {
    "id": "grok-build",
    "name": "Grok Build",
    "vendor": "xAI",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": false,
    "openSource": false,
    "verdict": "free",
    "evidence": "xAI's Free plan is $0/month with limited agent requests and limited Grok Build access.",
    "sourceUrl": "https://x.ai/pricing",
    "confidence": "verified"
  },
  {
    "id": "junie",
    "name": "Junie",
    "vendor": "JetBrains",
    "freeModels": true,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": true,
    "openSource": false,
    "verdict": "free",
    "evidence": "Junie Lite is a free model, always on, in every JetBrains account — no trial and no card required.",
    "sourceUrl": "https://junie.jetbrains.com/",
    "confidence": "verified"
  },
  {
    "id": "kilo",
    "name": "Kilo",
    "vendor": "Kilo Org",
    "freeModels": true,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "free",
    "evidence": "Kilo's $0 plan routes Auto Free through Kilo Gateway to free models, with BYOK and local models as fallbacks.",
    "sourceUrl": "https://kilo.ai/pricing",
    "confidence": "verified"
  },
  {
    "id": "mistral-vibe",
    "name": "Mistral Vibe",
    "vendor": "Mistral AI",
    "freeModels": false,
    "freeTierSubscription": true,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "free",
    "evidence": "Mistral's Free plan includes limited Vibe coding sessions; all-day CLI coding is a Pro feature.",
    "sourceUrl": "https://mistral.ai/pricing",
    "confidence": "verified"
  },
  {
    "id": "opencode",
    "name": "OpenCode",
    "vendor": "Anomaly (OpenCode)",
    "freeModels": true,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "free",
    "evidence": "OpenCode Zen lists free-tier chat models (glm-5.3-flash-free, deepseek-v4.1-flash-free, nemotron, mimo) for OpenCode clients.",
    "sourceUrl": "https://opencode.ai/docs/zen/",
    "confidence": "verified"
  },
  {
    "id": "opencode-v2",
    "name": "OpenCode V2",
    "vendor": "Anomaly (OpenCode)",
    "freeModels": true,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "free",
    "evidence": "V2 is the same OpenCode client and shares the Zen free-tier model list; the V2 docs do not restate it.",
    "sourceUrl": "https://opencode.ai/docs/zen/",
    "confidence": "partial"
  },
  {
    "id": "qoder",
    "name": "Qoder CLI",
    "vendor": "Qoder",
    "freeModels": true,
    "freeTierSubscription": true,
    "freeCredits": true,
    "byoKey": true,
    "openSource": false,
    "verdict": "free",
    "evidence": "Qoder's Free plan includes limited messages, BYOK, a 2-week Pro trial and a claimable 100 credits/day, with limited-time free models.",
    "sourceUrl": "https://docs.qoder.com/account/pricing",
    "confidence": "verified"
  },
  {
    "id": "sigit",
    "name": "siGit Code",
    "vendor": "siGit",
    "freeModels": true,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "free",
    "evidence": "No API key is required to start: first launch downloads a GGUF model and runs it on-device through Onde.",
    "sourceUrl": "https://github.com/getsigit/sigit",
    "confidence": "verified"
  },
  {
    "id": "auggie",
    "name": "Auggie CLI",
    "vendor": "Augment Code",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": true,
    "byoKey": false,
    "openSource": false,
    "verdict": "trial",
    "evidence": "Augment's pricing lists only paid plans (Standard $20/mo, Business $100/mo, Enterprise) and the FAQ only references trial usage terms.",
    "sourceUrl": "https://www.augmentcode.com/pricing",
    "confidence": "partial"
  },
  {
    "id": "bob",
    "name": "Bob",
    "vendor": "IBM",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": true,
    "byoKey": false,
    "openSource": false,
    "verdict": "trial",
    "evidence": "IBM Bob offers a free 30-day trial with 50 Bobcoins; a subscription is required to continue.",
    "sourceUrl": "https://bob.ibm.com/pricing",
    "confidence": "verified"
  },
  {
    "id": "cortex-code",
    "name": "Cortex Code",
    "vendor": "Snowflake",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": true,
    "byoKey": false,
    "openSource": false,
    "verdict": "trial",
    "evidence": "Snowflake offers a dedicated free CoCo CLI trial; standard Snowflake trial accounts do not include CoCo CLI.",
    "sourceUrl": "https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli",
    "confidence": "verified"
  },
  {
    "id": "nova",
    "name": "Nova",
    "vendor": "Compass AI",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": true,
    "byoKey": false,
    "openSource": false,
    "verdict": "trial",
    "evidence": "Every Nova plan starts with a 7-day free trial, after which per-seat pricing applies.",
    "sourceUrl": "https://www.compassap.ai/",
    "confidence": "verified"
  },
  {
    "id": "amp-acp",
    "name": "Amp",
    "vendor": "Sourcegraph",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": false,
    "verdict": "byo-key",
    "evidence": "Amp's Hobby tier is $0 but includes no hosted usage: you bring your own keys or use your ChatGPT/Claude subscription.",
    "sourceUrl": "https://ampcode.com/pricing",
    "confidence": "verified"
  },
  {
    "id": "autohand",
    "name": "Autohand Code",
    "vendor": "Autohand AI",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Free Apache-2.0 ACP agent whose setup connects your own provider credentials or a local model.",
    "sourceUrl": "https://github.com/autohandai/autohand-acp",
    "confidence": "verified"
  },
  {
    "id": "crow-cli",
    "name": "crow-cli",
    "vendor": "crow-cli",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Requires an API key for an OpenAI-compatible provider (OpenRouter, OpenAI or your own endpoint) configured by crow-cli init.",
    "sourceUrl": "https://github.com/crow-cli/crow-cli",
    "confidence": "verified"
  },
  {
    "id": "deepagents",
    "name": "DeepAgents",
    "vendor": "LangChain",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "MIT harness with no bundled inference; every run is bound to a model provider you supply a key for.",
    "sourceUrl": "https://docs.langchain.com/oss/javascript/deepagents/overview",
    "confidence": "verified"
  },
  {
    "id": "dimcode",
    "name": "DimCode",
    "vendor": "DimAgent",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": false,
    "verdict": "byo-key",
    "evidence": "DimCode is bring-your-own-model across 30+ providers, local Ollama/LM Studio and custom endpoints; its Coding Plan is listed as coming soon.",
    "sourceUrl": "https://dimcode.dev/",
    "confidence": "partial"
  },
  {
    "id": "dirac",
    "name": "Dirac",
    "vendor": "Dirac",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Apache-2.0 agent supporting dozens of providers; you bring the models and credentials you already pay for.",
    "sourceUrl": "https://github.com/dirac-run/dirac",
    "confidence": "verified"
  },
  {
    "id": "fast-agent",
    "name": "fast-agent",
    "vendor": "evalstate",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Apache-2.0 multi-provider agent framework; providers are configured with your own API keys.",
    "sourceUrl": "https://github.com/evalstate/fast-agent",
    "confidence": "verified"
  },
  {
    "id": "glm-acp-agent",
    "name": "GLM Agent",
    "vendor": "Z.ai (Zhipu AI) / stefandevo",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Built for the Z.AI GLM Coding Plan endpoint only, so it needs a paid Coding Plan API key rather than free GLM promos.",
    "sourceUrl": "https://github.com/stefandevo/glm-acp-agent",
    "confidence": "verified"
  },
  {
    "id": "goose",
    "name": "goose",
    "vendor": "Block / Agentic AI Foundation",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Apache-2.0 agent that runs with your own API keys or existing Claude, ChatGPT or Gemini subscriptions.",
    "sourceUrl": "https://github.com/block/goose",
    "confidence": "verified"
  },
  {
    "id": "harn",
    "name": "Harn",
    "vendor": "Burin Labs",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Apache-2.0 runtime where hosted models need the provider's credentials and local models run offline.",
    "sourceUrl": "https://github.com/burin-labs/harn",
    "confidence": "verified"
  },
  {
    "id": "kimchi",
    "name": "Kimchi",
    "vendor": "Cast AI",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Hosted plans start at $20/mo; the free Open Source plan is CLI-only and brings your own inference.",
    "sourceUrl": "https://kimchi.dev/pricing",
    "confidence": "verified"
  },
  {
    "id": "kimi",
    "name": "Kimi CLI",
    "vendor": "Moonshot AI",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Kimi Code requires a paid Kimi plan or API key, and the MIT CLI can also use any BYO provider key.",
    "sourceUrl": "https://www.kimi.com/coding",
    "confidence": "verified"
  },
  {
    "id": "minion-code",
    "name": "Minion Code",
    "vendor": "femto",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "AGPL-3.0 agent that needs an LLM configured (provider API key or OpenAI-compatible endpoint) before it can run.",
    "sourceUrl": "https://github.com/femto/minion-code",
    "confidence": "partial"
  },
  {
    "id": "pi-acp",
    "name": "pi ACP",
    "vendor": "Earendil Works",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "MIT agent; run /login to connect a subscription or API key — there is no free hosted tier.",
    "sourceUrl": "https://github.com/earendil-works/pi",
    "confidence": "verified"
  },
  {
    "id": "poolside",
    "name": "Poolside",
    "vendor": "Poolside",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": false,
    "verdict": "byo-key",
    "evidence": "pool runs on your own Poolside API key, OpenRouter, Ollama or any OpenAI-compatible endpoint; no free Poolside-hosted tier is published.",
    "sourceUrl": "https://github.com/poolsideai/pool",
    "confidence": "partial"
  },
  {
    "id": "qwen-code",
    "name": "Qwen Code",
    "vendor": "Alibaba",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "The Qwen OAuth free tier was discontinued on 2026-04-15; use an API key, Coding Plan or third-party provider instead.",
    "sourceUrl": "https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/",
    "confidence": "verified"
  },
  {
    "id": "stakpak",
    "name": "Stakpak",
    "vendor": "Stakpak",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "Stakpak's always-free Open Source plan is BYO keys or local models; hosted plans start at $15/mo.",
    "sourceUrl": "https://stakpak.dev/pricing",
    "confidence": "verified"
  },
  {
    "id": "vtcode",
    "name": "VT Code",
    "vendor": "vinhnx",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": true,
    "verdict": "byo-key",
    "evidence": "MIT/Apache-2.0 agent; add your own provider credentials with vtcode secret add or a supported provider login.",
    "sourceUrl": "https://github.com/vinhnx/VTCode",
    "confidence": "verified"
  },
  {
    "id": "agoragentic-acp",
    "name": "Agoragentic",
    "vendor": "ACRE / Agoragentic",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": false,
    "openSource": true,
    "verdict": "paid",
    "evidence": "Public catalog discovery is $0, but every capability invocation is billed per call in USDC on Base.",
    "sourceUrl": "https://agoragentic.com/pricing",
    "confidence": "verified"
  },
  {
    "id": "claude-acp",
    "name": "Claude Agent",
    "vendor": "Anthropic",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": true,
    "openSource": false,
    "verdict": "paid",
    "evidence": "Claude Code is included only from the Pro plan ($20/mo); the free Claude plan does not include it.",
    "sourceUrl": "https://claude.com/pricing",
    "confidence": "verified"
  },
  {
    "id": "factory-droid",
    "name": "Factory Droid",
    "vendor": "Factory AI",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": false,
    "openSource": false,
    "verdict": "paid",
    "evidence": "Factory's individual plans start at Pro $20/mo; the free Droid Core model pool only applies after paid Standard Usage runs out.",
    "sourceUrl": "https://docs.factory.com/pricing/individuals",
    "confidence": "verified"
  },
  {
    "id": "minimax-code",
    "name": "MiniMax Code",
    "vendor": "MiniMax",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": false,
    "openSource": true,
    "verdict": "paid",
    "evidence": "MiniMax Code requires signing in with an M Plan subscription; the published pricing is paid plans and per-token rates.",
    "sourceUrl": "https://platform.minimax.io/docs/m-plan/minimax-code",
    "confidence": "partial"
  },
  {
    "id": "corust-agent",
    "name": "Corust Agent",
    "vendor": "Corust.ai",
    "freeModels": false,
    "freeTierSubscription": false,
    "freeCredits": false,
    "byoKey": false,
    "openSource": true,
    "verdict": "unknown",
    "evidence": "corust.ai did not resolve and the release repo ships no README or pricing, so auth and cost could not be verified.",
    "sourceUrl": "https://github.com/Corust-ai/corust-agent-release",
    "confidence": "unverified"
  }
]
```

## How CodeItLab applies this

- **Agents page** (`#/settings/codeitlab/agents`) opens in **Free only** mode: the 16 `free` entries are the
  whole list, the Premium tab and the unverified rest of the registry are hidden, and a banner explains
  what is hidden.
- **Disable premium providers (N)** turns off every enabled provider instance whose agent is not in the free
  list, so the composer and model picker can only route prompts to agents that can run at $0. The action is
  reversible: turn Free only off, then re-enable an instance in **Settings → Providers**.
- The live environment used for the 2026-10-24 verification had 14 free instances enabled and 11 non-free
  ones enabled; applying the action disabled all 11 (`amp-acp`, `goose`, `qwen-code`, `deepagents`, `dirac`,
  `harn`, `auggie`, `factory-droid`, `kimchi`, `nova`, `poolside`) and left the free ones untouched.
- Multi-account support for OAuth agents is documented in [`ACP-MULTI-ACCOUNT.md`](./ACP-MULTI-ACCOUNT.md);
  it is independent of the free/premium split.

## Verification (2026-10-24)

- Headless run of the built app artifacts (same server + web bundle the desktop shell loads):
  Free only `aria-pressed=true`, banner text, exactly 16 freemium cards, no premium tab, no
  "More ACP agents"; clicking the action produced "Turned off 3 premium providers" and the settings
  showed only the free instances enabled. Screenshots `21-agents-free-only.png`,
  `22-premium-disabled-notice.png` in `release/verification/acp-connections/`.
- Multi-account: `Add another account` on `acpRegistry_gemini` created `acpRegistry_gemini_2`
  (`Gemini · account 2`, `accountProfile: true`) and populated
  `<state>/userdata/acp-accounts/acpRegistry_gemini_2/.gemini/…`, proving the isolated HOME took effect
  (`23-gemini-account-2.png`).

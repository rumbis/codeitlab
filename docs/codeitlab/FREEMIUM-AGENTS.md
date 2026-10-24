# Free agents (freemium ACP catalog)

CodeitLab can drive any agent in the official [ACP registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) — the same list the provider wizard searches. This page adds a curated, opinionated layer on top, split into **free** agents (a free model or a free-tier subscription, no card) and **premium** agents (paid plans, trial credits only, or BYO keys), both with one-click install.

The authoritative per-agent evidence is [`ACP-FREE-TIERS.md`](./ACP-FREE-TIERS.md): an audit of all 43 registry agents on 2026-10-24 with a verdict, a one-line fact and the vendor's own source URL for each. `apps/web/src/codeitlab/freemiumAgents.ts` is generated from that classification: the **Freemium** tab holds the 16 `free` agents, the **Premium** tab the other 27.

Open **Settings → CodeitLab → Agents** (or search "free agents" in settings search). Each card shows why the agent is free to start, a link to the vendor's own pricing or docs page, and an **Install** button.

## Free-only mode

The page opens in **Free only** mode: it shows just the free agents, hides the Premium tab and the unverified rest of the registry, and offers **Disable premium providers (N)**. That action turns off every enabled provider instance whose agent has no free tier, so the composer and model picker cannot route a prompt to a paid agent by accident. Turning **Free only** off restores the Premium tab and the full registry; the instances stay disabled until re-enabled in **Settings → Providers**.

## What install does

The button runs the same two steps as the ACP provider wizard, without a terminal:

1. `server.prepareAcpRegistryAgent` — downloads the registry agent into the managed tools directory (npx/uvx package or the platform binary, with the registry's integrity check).
2. `provider.mutateProviderInstance` — creates and enables an `acpRegistry` provider instance for that agent id (`source: "registry"`, `distribution: "auto"`).

Installed cards show the provider instance's live health instead of a generic label: **Ready**, **Sign in needed**, **Needs attention** (with the server's message as a tooltip) or **Disabled**. **Sign in** and **Manage** deep-link to that instance in **Settings → Providers** (`?instanceId=…`), where it can be authenticated, renamed, disabled or removed like any other provider. OAuth agents can hold more than one account — see [`ACP-MULTI-ACCOUNT.md`](./ACP-MULTI-ACCOUNT.md).

## Free and premium

- **Freemium (16)** — agents a user can actually run at $0 without a card: a free plan with included usage (Copilot Free, Cursor Hobby, Devin Free, Antigravity, Grok Build, ChatGPT Free → Codex), a free model (Junie Lite, Cline free models, OpenCode Zen free models, siGit on-device) or a free tier with limits (Gemini CLI, Mistral Vibe, Kilo, Qoder).
- **Premium (27)** — everything else: paid-only (Claude Agent, Factory Droid, MiniMax Code, Agoragentic), trial credits only (IBM Bob, Cortex Code, Auggie, Nova) and open-source agents whose model usage still needs your own keys (goose, pi, Qwen Code, Kimi, DeepAgents, fast-agent, Stakpak, VT Code, crow-cli, Autohand, Dirac, Harn, Amp, GLM Agent, Poolside, DimCode, Kimchi, Minion, Corust). Each card says what the user will be asked for.

## Region awareness

The page shows a **Region: XX** chip from the browser locale (`navigator.language`, falling back to a small time-zone map such as `Asia/Nicosia` → `CY`). Entries whose vendor documents a restriction get a **Not available in your region** warning badge but stay installable — the user may be travelling or on a VPN. The **Available in my region** toggle hides entries that are known-unavailable, while entries with no documented restriction stay visible (unknown is not the same as unavailable).

Only **MiniMax Code** is seeded today (`reportedBlockedCountries: ["CY"]`, UNVERIFIED from a user-reported failure); the rest wait for `docs/codeitlab/ACP-REGION-AVAILABILITY.md`.

## Catalog (free agents)

Audited on 2026-10-24 against each vendor's own pricing or documentation page. Free tiers change; the card links to the current source and the audit records the confidence.

| Agent              | Why it is free                                                                | Source                                                                  |
| ------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| GitHub Copilot CLI | Copilot Free includes a monthly AI-credit allowance; CLI is in every plan     | [docs.github.com](https://docs.github.com/en/copilot/get-started/plans) |
| Cline              | Rotating free-model promotions for any Cline account                          | [docs.cline.bot](https://docs.cline.bot/getting-started/free-models)    |
| Kilo               | Free plan; Auto Free routes to free models, BYOK/local as fallback            | [kilo.ai](https://kilo.ai/pricing)                                      |
| Mistral Vibe       | Free plan includes limited Vibe coding sessions                               | [mistral.ai](https://mistral.ai/pricing)                                |
| Junie              | Junie Lite: a free model in every JetBrains account                           | [junie.jetbrains.com](https://junie.jetbrains.com/)                     |
| Qoder CLI          | Free plan: limited messages, 2-week Pro trial, 100 claimable credits/day      | [docs.qoder.com](https://docs.qoder.com/account/pricing)                |
| Codebuddy Code     | Limited-time free Personal edition                                            | [codebuddy.cn](https://www.codebuddy.cn/pricing)                        |
| Devin CLI          | Free $0 plan: light agent quota, limited models                               | [devin.ai](https://devin.ai/pricing)                                    |
| Cursor             | Free Hobby plan at $0 with limited agent and chat requests                    | [cursor.com](https://cursor.com/pricing)                                |
| Gemini CLI         | Free tier: 1,000 requests/day with Google sign-in (250/day with free API key) | [geminicli.com](https://geminicli.com/docs/resources/quota-and-pricing) |
| Codex              | ChatGPT Free includes limited Codex access                                    | [chatgpt.com](https://chatgpt.com/pricing)                              |
| Grok Build         | xAI Free plan at $0/month with limited agent requests                         | [x.ai](https://x.ai/pricing)                                            |
| Google Antigravity | Individual Antigravity plan is $0/month with basic weekly rate limits         | [antigravity.google](https://antigravity.google/pricing)                |
| OpenCode           | OpenCode Zen free-tier models for OpenCode clients                            | [opencode.ai](https://opencode.ai/docs/zen/)                            |
| OpenCode V2        | Same client and Zen free-tier models                                          | [opencode.ai](https://opencode.ai/docs/zen/)                            |
| siGit Code         | No API key needed: first launch runs a GGUF model on-device                   | [github.com/getsigit/sigit](https://github.com/getsigit/sigit)          |

## Adding or updating an entry

Edit `apps/web/src/codeitlab/freemiumAgents.ts`. Free entries need the registry `id`, the display `name`, a one-line `summary`, a factual `freeNote`, `kind: "free-tier"`, a `docsUrl` that actually shows the free path, and `tier: "freemium"`. Premium entries go in `PREMIUM_AGENTS` with `tier: "premium"`, a one-line `summary`, and a `premiumNote` (paid plan / trial credits / region / BYO key); `docsUrl` is optional because the live registry fills it. Use `availability` only when the vendor documents the restriction, and say UNVERIFIED when the source is not confirmed. Keep the note under ~100 characters; put time limits and promotions in `caveat`. If a vendor's free tier changes, update the note, the source link and `ACP-FREE-TIERS.md` together — the catalog is only as good as its sources.

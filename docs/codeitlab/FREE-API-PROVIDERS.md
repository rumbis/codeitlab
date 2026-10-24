# Free API providers (OpenAI-compatible)

Powers the **Free API providers** section of the provider wizard: a user who has no paid subscription can pick a provider that serves an OpenAI-compatible `/v1` endpoint and get a working agent for free.

Verified on **2026-10-24** against each provider's own pricing/rate-limit page. Anything we could not read on an official page is marked **UNVERIFIED** rather than guessed.

## How to read this

- **Free (no card)** — a real, ongoing free allowance that works without adding payment details.
- **Free models** — the provider is paid overall but serves specific models at $0.
- **Trial credits** — one-off credits that expire; a card or verification is usually required.
- **Paid** — listed for completeness because the provider is popular; no free tier found.
- All endpoints are OpenAI-compatible (`POST {baseUrl}/chat/completions`) unless the notes say otherwise.
- Auth is `Authorization: Bearer <key>` for every entry in the JSON block.

## Table

| Provider                         | Free?                    | What you get today                                                                                           | Base URL                                                           | EU / Cyprus                                                                                | Sign-up                                        |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| OpenRouter                       | Free models (no card)    | `:free` model variants; 20 req/min, 50 req/day with <10 credits, 1,000 req/day at ≥10 credits                | `https://openrouter.ai/api/v1`                                     | Global; no country list found                                                              | https://openrouter.ai/settings/keys            |
| Groq                             | Free (no card)           | Free plan with per-model RPM/RPD/TPM/TPD caps (see live Free Plan table)                                     | `https://api.groq.com/openai/v1`                                   | Global; no country list found                                                              | https://console.groq.com/keys                  |
| Google AI Studio (Gemini API)    | Free (no card)           | Gemini API free tier; some models excluded (e.g. Gemini 4 Argon); per-model RPM/RPD                          | `https://generativelanguage.googleapis.com/v1beta/openai/`         | **Cyprus explicitly listed**                                                               | https://aistudio.google.com/apikey             |
| Cerebras                         | Trial credits            | $5 free credits for 30 days; Free Trial limits (e.g. 5 RPM, 1M tokens/day)                                   | `https://api.cerebras.ai/v1`                                       | Global; no country list found                                                              | https://cloud.cerebras.ai                      |
| Mistral AI                       | Free (no card)           | "Free mode" Studio plan + API key; rate-limited                                                              | `https://api.mistral.ai/v1`                                        | EU vendor (France); no list found                                                          | https://console.mistral.ai/api-keys            |
| GitHub Models                    | Free (no card)           | Free with any GitHub account, rate-limited; limits UNVERIFIED (docs page blocked our fetcher)                | `https://models.github.ai/inference`                               | Wherever GitHub is available (sanctions excluded)                                          | https://github.com/settings/tokens             |
| Cohere                           | Free trial key           | Trial keys: 1,000 API calls/month, 20 req/min                                                                | `https://api.cohere.ai/compatibility/v1`                           | Global; no country list found                                                              | https://dashboard.cohere.com/api-keys          |
| Cloudflare Workers AI            | Free (no card)           | 10,000 Neurons/day on the Workers Free plan                                                                  | `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1` | Global; no country list found                                                              | https://dash.cloudflare.com/profile/api-tokens |
| Alibaba Model Studio (DashScope) | Trial quota              | Per-model new-user free quota (e.g. qwen-max 1,000,000 tokens), one-off, not recurring                       | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`           | Singapore (international) region; China region separate                                    | https://bailian.console.alibabacloud.com       |
| OpenCode Zen                     | Free models              | Big Pickle, GLM-5.3-Flash, DeepSeek V4.1 Flash at $0 — but free-tier chat models require the OpenCode client | `https://opencode.ai/inference/openai/v1`                          | Global; no country list found                                                              | https://opencode.ai/auth                       |
| Novita AI                        | Free models              | A few $0 models (e.g. Apodex 1.1 Mini); rest paid                                                            | `https://api.novita.ai/v3/openai`                                  | Global; no country list found                                                              | https://novita.ai/settings/key-management      |
| Z.AI (GLM)                       | Paid                     | No free model tier verified; pricing page shows only "limited-time free" cache storage                       | `https://api.z.ai/api/paas/v4`                                     | Global; no country list found                                                              | https://z.ai/manage-apikey/apikey-list         |
| Moonshot / Kimi                  | Paid                     | No free API tier verified                                                                                    | `https://api.moonshot.ai/v1`                                       | Global; no country list found                                                              | https://platform.moonshot.ai/console/api-keys  |
| MiniMax                          | Paid                     | No free LLM quota verified (only free image inputs on video tasks)                                           | `https://api.minimax.io/v1`                                        | No published EU exclusion, but a Cyprus block is observed — see ACP-REGION-AVAILABILITY.md | https://platform.minimax.io                    |
| DeepSeek                         | Paid                     | No free tier verified                                                                                        | `https://api.deepseek.com/v1`                                      | Global; no country list found                                                              | https://platform.deepseek.com/api_keys         |
| Together AI                      | Free models (UNVERIFIED) | Pricing page shows some $0/experimental endpoints; no general free tier verified                             | `https://api.together.xyz/v1`                                      | Global; no country list found                                                              | https://api.together.ai/settings/api-keys      |
| Fireworks AI                     | Paid                     | No free tier verified                                                                                        | `https://api.fireworks.ai/inference/v1`                            | Global; no country list found                                                              | https://fireworks.ai/account/api-keys          |
| SambaNova                        | UNVERIFIED               | Free tier widely reported; rate-limit docs returned 404 to our fetcher                                       | `https://api.sambanova.ai/v1`                                      | Global; no country list found                                                              | https://cloud.sambanova.ai/apis                |
| xAI                              | Paid                     | No free API tier verified (the Grok Build CLI is separately "available to try for free")                     | `https://api.x.ai/v1`                                              | Global; no country list found                                                              | https://console.x.ai                           |

**Local runtimes** (no key, no account, no country question) are the other genuinely free option: Ollama (`http://localhost:11434/v1`) and LM Studio (`http://localhost:1234/v1`) both speak the OpenAI protocol. They are excluded from the JSON block because it assumes bearer auth.

## Top 8 to ship first

| #   | id                      | Why                                                                      |
| --- | ----------------------- | ------------------------------------------------------------------------ |
| 1   | `openrouter`            | One key, many `:free` models, documented rate limits, no card            |
| 2   | `groq`                  | Fastest free inference; no card; generous per-model caps                 |
| 3   | `google-ai-studio`      | Free Gemini tier, and Cyprus is explicitly in the available-regions list |
| 4   | `cerebras`              | Huge free throughput, but trial credits + payment verification           |
| 5   | `mistral`               | EU-hosted vendor, free Studio mode, no card                              |
| 6   | `github-models`         | Free for every GitHub user, one PAT                                      |
| 7   | `cohere`                | Simple trial key, 1,000 calls/month, good for testing                    |
| 8   | `cloudflare-workers-ai` | 10k Neurons/day free, no card, global                                    |

## Caveats

- **Rate limits change often.** The numbers above are the ones printed on the vendor page on 2026-10-24. Read them from the vendor at runtime where possible instead of hard-coding.
- **"Free" is not the same as "unlimited".** OpenRouter's 50 req/day free-model cap and Cohere's 1,000 calls/month are easy to exhaust with an agent loop; surface the vendor's 429 message rather than retrying blindly.
- **Free models can be withdrawn.** OpenCode Zen's free tier is tied to its own client, and Google explicitly excludes its newest model (Gemini 4 Argon) from the free tier.
- **Regional gating is rare but real.** Google publishes a country list that includes Cyprus; MiniMax publishes none yet blocks at least one Cyprus user; Alibaba splits Singapore and China regions. See `ACP-REGION-AVAILABILITY.md`.

## Machine-readable

```json
[
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "auth": "bearer",
    "freeTier": "free models (:free variants)",
    "limits": "20 req/min; 50 req/day under 10 credits; 1000 req/day at 10+ credits",
    "countries": "global; no country list found",
    "keyUrl": "https://openrouter.ai/settings/keys",
    "docsUrl": "https://openrouter.ai/docs/api-reference/limits",
    "notes": "no card needed for free models"
  },
  {
    "id": "groq",
    "name": "Groq",
    "baseUrl": "https://api.groq.com/openai/v1",
    "auth": "bearer",
    "freeTier": "free plan",
    "limits": "per-model RPM/RPD/TPM/TPD caps; see Free Plan table",
    "countries": "global; no country list found",
    "keyUrl": "https://console.groq.com/keys",
    "docsUrl": "https://console.groq.com/docs/rate-limits",
    "notes": "no card"
  },
  {
    "id": "google-ai-studio",
    "name": "Google AI Studio (Gemini API)",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "auth": "bearer",
    "freeTier": "Gemini API free tier",
    "limits": "per-model RPM/RPD/TPM; some models excluded",
    "countries": "Cyprus explicitly listed in available regions",
    "keyUrl": "https://aistudio.google.com/apikey",
    "docsUrl": "https://ai.google.dev/gemini-api/docs/rate-limits",
    "notes": "no card; Gemini 4 Argon not on free tier"
  },
  {
    "id": "cerebras",
    "name": "Cerebras",
    "baseUrl": "https://api.cerebras.ai/v1",
    "auth": "bearer",
    "freeTier": "trial credits",
    "limits": "$5 credits for 30 days; Free Trial 5 RPM and 1M tokens/day",
    "countries": "global; no country list found",
    "keyUrl": "https://cloud.cerebras.ai",
    "docsUrl": "https://inference-docs.cerebras.ai/support/rate-limits",
    "notes": "requires verified payment method"
  },
  {
    "id": "mistral",
    "name": "Mistral AI",
    "baseUrl": "https://api.mistral.ai/v1",
    "auth": "bearer",
    "freeTier": "free Studio mode",
    "limits": "rate-limited; exact caps UNVERIFIED",
    "countries": "EU vendor; no country list found",
    "keyUrl": "https://console.mistral.ai/api-keys",
    "docsUrl": "https://docs.mistral.ai/getting-started/quickstart/",
    "notes": "activate Studio in Free mode"
  },
  {
    "id": "github-models",
    "name": "GitHub Models",
    "baseUrl": "https://models.github.ai/inference",
    "auth": "bearer",
    "freeTier": "free with GitHub account",
    "limits": "rate-limited; caps UNVERIFIED",
    "countries": "where GitHub is available; sanctions excluded",
    "keyUrl": "https://github.com/settings/tokens",
    "docsUrl": "https://docs.github.com/en/github-models",
    "notes": "GitHub PAT as bearer"
  },
  {
    "id": "cohere",
    "name": "Cohere",
    "baseUrl": "https://api.cohere.ai/compatibility/v1",
    "auth": "bearer",
    "freeTier": "free trial key",
    "limits": "1000 API calls/month; 20 req/min",
    "countries": "global; no country list found",
    "keyUrl": "https://dashboard.cohere.com/api-keys",
    "docsUrl": "https://docs.cohere.com/docs/rate-limits",
    "notes": "trial key, not production"
  },
  {
    "id": "cloudflare-workers-ai",
    "name": "Cloudflare Workers AI",
    "baseUrl": "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    "auth": "bearer",
    "freeTier": "10000 Neurons/day",
    "limits": "10000 Neurons/day on Workers Free",
    "countries": "global; no country list found",
    "keyUrl": "https://dash.cloudflare.com/profile/api-tokens",
    "docsUrl": "https://developers.cloudflare.com/workers-ai/platform/pricing/",
    "notes": "account id required in URL"
  },
  {
    "id": "alibaba-dashscope",
    "name": "Alibaba Model Studio (DashScope)",
    "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "auth": "bearer",
    "freeTier": "new-user free quota",
    "limits": "per-model one-off quota; e.g. qwen-max 1M tokens",
    "countries": "Singapore international region; China region separate",
    "keyUrl": "https://bailian.console.alibabacloud.com",
    "docsUrl": "https://www.alibabacloud.com/help/en/model-studio/new-free-quota",
    "notes": "one-off quota, not recurring"
  },
  {
    "id": "opencode-zen",
    "name": "OpenCode Zen",
    "baseUrl": "https://opencode.ai/inference/openai/v1",
    "auth": "bearer",
    "freeTier": "free models",
    "limits": "UNVERIFIED; free models require OpenCode client",
    "countries": "global; no country list found",
    "keyUrl": "https://opencode.ai/auth",
    "docsUrl": "https://opencode.ai/docs/zen/",
    "notes": "Big Pickle, GLM-5.3-Flash, DeepSeek V4.1 Flash at $0"
  },
  {
    "id": "novita",
    "name": "Novita AI",
    "baseUrl": "https://api.novita.ai/v3/openai",
    "auth": "bearer",
    "freeTier": "some free models",
    "limits": "UNVERIFIED",
    "countries": "global; no country list found",
    "keyUrl": "https://novita.ai/settings/key-management",
    "docsUrl": "https://novita.ai/pricing",
    "notes": "e.g. Apodex 1.1 Mini free; rest paid"
  },
  {
    "id": "zai",
    "name": "Z.AI (GLM)",
    "baseUrl": "https://api.z.ai/api/paas/v4",
    "auth": "bearer",
    "freeTier": "none verified",
    "limits": "paid; limited-time free cache storage only",
    "countries": "global; no country list found",
    "keyUrl": "https://z.ai/manage-apikey/apikey-list",
    "docsUrl": "https://docs.z.ai/guides/overview/pricing",
    "notes": "GLM Coding Plan subscription"
  },
  {
    "id": "moonshot",
    "name": "Moonshot AI (Kimi)",
    "baseUrl": "https://api.moonshot.ai/v1",
    "auth": "bearer",
    "freeTier": "none verified",
    "limits": "paid",
    "countries": "global; no country list found",
    "keyUrl": "https://platform.moonshot.ai/console/api-keys",
    "docsUrl": "https://platform.moonshot.ai/docs/pricing/chat",
    "notes": "K2 series retiring end of 2026"
  },
  {
    "id": "minimax",
    "name": "MiniMax",
    "baseUrl": "https://api.minimax.io/v1",
    "auth": "bearer",
    "freeTier": "none verified",
    "limits": "paid; M Plan subscription",
    "countries": "no published EU exclusion; Cyprus block observed",
    "keyUrl": "https://platform.minimax.io",
    "docsUrl": "https://platform.minimax.io/docs/guides/pricing-paygo",
    "notes": "only free image inputs on video tasks"
  },
  {
    "id": "deepseek",
    "name": "DeepSeek",
    "baseUrl": "https://api.deepseek.com/v1",
    "auth": "bearer",
    "freeTier": "none verified",
    "limits": "paid; low per-token price",
    "countries": "global; no country list found",
    "keyUrl": "https://platform.deepseek.com/api_keys",
    "docsUrl": "https://api-docs.deepseek.com/quick_start/pricing",
    "notes": "no free tier found"
  },
  {
    "id": "together",
    "name": "Together AI",
    "baseUrl": "https://api.together.xyz/v1",
    "auth": "bearer",
    "freeTier": "some free endpoints (UNVERIFIED)",
    "limits": "UNVERIFIED",
    "countries": "global; no country list found",
    "keyUrl": "https://api.together.ai/settings/api-keys",
    "docsUrl": "https://together.ai/pricing",
    "notes": "free/experimental models vary"
  },
  {
    "id": "fireworks",
    "name": "Fireworks AI",
    "baseUrl": "https://api.fireworks.ai/inference/v1",
    "auth": "bearer",
    "freeTier": "none verified",
    "limits": "UNVERIFIED",
    "countries": "global; no country list found",
    "keyUrl": "https://fireworks.ai/account/api-keys",
    "docsUrl": "https://fireworks.ai/pricing",
    "notes": "rate-limit docs returned 404"
  },
  {
    "id": "sambanova",
    "name": "SambaNova",
    "baseUrl": "https://api.sambanova.ai/v1",
    "auth": "bearer",
    "freeTier": "UNVERIFIED",
    "limits": "UNVERIFIED",
    "countries": "global; no country list found",
    "keyUrl": "https://cloud.sambanova.ai/apis",
    "docsUrl": "https://docs.sambanova.ai",
    "notes": "rate-limit docs returned 404"
  },
  {
    "id": "xai",
    "name": "xAI",
    "baseUrl": "https://api.x.ai/v1",
    "auth": "bearer",
    "freeTier": "none verified",
    "limits": "paid",
    "countries": "global; no country list found",
    "keyUrl": "https://console.x.ai",
    "docsUrl": "https://docs.x.ai/docs/models",
    "notes": "Grok Build CLI is separately try-for-free"
  }
]
```

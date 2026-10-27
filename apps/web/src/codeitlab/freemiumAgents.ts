/**
 * Curated "free to start" ACP agents.
 *
 * Every entry points at an agent from the official ACP registry
 * (https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json), so
 * the install path is the same managed download the ACP provider wizard uses.
 * The free note is the reason the agent is worth trying without a card; it was
 * verified against the vendor's own pricing or docs page (see `docsUrl`), and
 * the registry remains the source of truth for name, version and icon.
 *
 * Kinds:
 * - `free-tier`: the vendor serves free usage with an account (limits apply).
 * - `free-credits`: a time-boxed trial or credit grant, then paid.
 * - `byo-key`: the app is free, but hosted usage needs the user's own keys.
 * - `open-source`: the agent itself is open source; models may still cost.
 */
export type FreemiumKind = "free-tier" | "free-credits" | "byo-key" | "open-source";

/** Which area of the Agents page an entry belongs to. */
export type AgentTier = "freemium" | "premium";

/**
 * Where an agent can be used. Only fill this from the vendor's own terms: the
 * research doc (docs/codeitlab/ACP-REGION-AVAILABILITY.md) is the source of
 * truth, so entries without it are "unknown", never implicitly "available".
 */
export interface AgentAvailability {
  /** ISO 3166-1 alpha-2 countries the vendor serves. */
  readonly countries?: readonly string[];
  /** ISO 3166-1 alpha-2 countries the vendor does not serve. */
  readonly blockedCountries?: readonly string[];
  /**
   * Countries where the agent was observed to fail for real users while the
   * vendor publishes no such restriction. Warned, never hidden: an undocumented
   * block is not policy and the user may be travelling or on a VPN.
   */
  readonly reportedBlockedCountries?: readonly string[];
  /** Shown with the region badge; say UNVERIFIED when there is no source. */
  readonly note?: string;
  readonly sourceUrl?: string;
}

export const AGENT_TIER_LABELS: Record<AgentTier, string> = {
  freemium: "Freemium",
  premium: "Premium",
};

export interface FreemiumAgent {
  /** Agent id in the official ACP registry. */
  readonly id: string;
  /** Display name used before the registry answers. */
  readonly name: string;
  /** One line about what the agent is. */
  readonly summary: string;
  /** Why it is free to start, phrased as a fact. */
  readonly freeNote: string;
  readonly kind: FreemiumKind;
  /** Curated free-to-start entries; the Premium tab holds everything else. */
  readonly tier: "freemium";
  /** Official docs or pricing page the free note comes from. */
  readonly docsUrl: string;
  /** Short caveat shown next to the free note. */
  readonly caveat?: string;
  /** Region restrictions, only when the vendor documents them. */
  readonly availability?: AgentAvailability;
}

export const FREEMIUM_KIND_LABELS: Record<FreemiumKind, string> = {
  "free-tier": "Free tier",
  "free-credits": "Free credits",
  "byo-key": "Your keys",
  "open-source": "Open source",
};

export const FREEMIUM_AGENTS: readonly FreemiumAgent[] = [
  {
    id: "antigravity-acp",
    name: "Google Antigravity",
    summary: "Google's Antigravity agent suite, ACP edition.",
    freeNote: "Individual Antigravity plan is $0/month with basic weekly rate limits.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://antigravity.google/pricing",
  },
  {
    id: "cline",
    name: "Cline",
    summary: "Open-source autonomous coding agent.",
    freeNote:
      "Free model promotions rotate for any Cline account; the free models are tagged FREE.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://docs.cline.bot/getting-started/free-models",
    caveat: "Free models rotate, are quota-limited, and are not available through the Cline API.",
  },
  {
    id: "codebuddy-code",
    name: "Codebuddy Code",
    summary: "Tencent Cloud's coding agent.",
    freeNote: "Limited-time free Personal edition per Tencent's pricing page.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://www.codebuddy.cn/pricing",
    caveat: "The free Personal edition is explicitly a limited-time promotion.",
  },
  {
    id: "codex-acp",
    name: "Codex",
    summary: "OpenAI's Codex agent.",
    freeNote: "ChatGPT Free includes limited Codex access; paid plans only raise the allowance.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://chatgpt.com/pricing",
  },
  {
    id: "cursor",
    name: "Cursor",
    summary: "Cursor's terminal agent.",
    freeNote: "Free Hobby plan at $0 with limited agent and chat requests.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://cursor.com/pricing",
  },
  {
    id: "devin",
    name: "Devin",
    summary: "Cognition's agentic engineer, ACP edition.",
    freeNote: "Free $0 plan: light agent quota, limited models, unlimited tab/inline edits.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://devin.ai/pricing",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    summary: "Google's official CLI for Gemini.",
    freeNote:
      "Free tier: 1,000 model requests/day with Google sign-in (250/day with a free API key).",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://geminicli.com/docs/resources/quota-and-pricing",
    caveat: "Docs list the free tier, but ACP sign-in was rejected for some individual accounts.",
  },
  {
    id: "github-copilot-cli",
    name: "Copilot",
    summary: "GitHub's Copilot agent for the terminal.",
    freeNote: "Copilot Free includes a monthly AI-credit allowance; Copilot CLI is in every plan.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://docs.github.com/en/copilot/get-started/plans",
  },
  {
    id: "grok-build",
    name: "Grok Build",
    summary: "xAI's Grok coding agent.",
    freeNote: "xAI Free plan at $0/month with limited agent requests and Grok Build access.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://x.ai/pricing",
  },
  {
    id: "junie",
    name: "Junie",
    summary: "JetBrains' coding agent, ACP edition.",
    freeNote: "Junie Lite: a free model in every JetBrains account, BYO key at zero markup.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://junie.jetbrains.com/",
  },
  {
    id: "kilo",
    name: "Kilo",
    summary: "Open-source agent with a hosted free plan.",
    freeNote: "Free plan for individuals; Auto Free routes to free models, or use BYOK/local.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://kilo.ai/pricing",
  },
  {
    id: "mistral-vibe",
    name: "Mistral Vibe",
    summary: "Mistral's open-source coding CLI.",
    freeNote: "Free plan includes limited Vibe coding sessions; Pro adds full-day access.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://mistral.ai/pricing",
    caveat: "Vibe is the former Le Chat.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    summary: "Open-source terminal agent with hosted models.",
    freeNote:
      "OpenCode Zen lists free-tier models (GLM, DeepSeek, Nemotron, MiMo) for OpenCode clients.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://opencode.ai/docs/zen/",
  },
  {
    id: "opencode-v2",
    name: "OpenCode V2",
    summary: "OpenCode's hosted v2 agent.",
    freeNote: "Same OpenCode client and Zen free-tier models; the V2 docs do not restate the list.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://opencode.ai/docs/zen/",
    caveat: "Free models come from OpenCode Zen; V2 docs do not restate them.",
  },
  {
    id: "qoder",
    name: "Qoder CLI",
    summary: "Qoder's agentic coding CLI.",
    freeNote: "Free plan: limited messages, BYOK, 2-week Pro trial and 100 claimable credits/day.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://docs.qoder.com/account/pricing",
    caveat: "The 100-credit daily claim began 2026-09-18 in the Qoder International desktop app.",
  },
  {
    id: "sigit",
    name: "siGit Code",
    summary: "Local-first agent with optional on-device models.",
    freeNote: "No API key needed: first launch downloads a GGUF model and runs it on-device.",
    kind: "free-tier",
    tier: "freemium",
    docsUrl: "https://github.com/getsigit/sigit",
  },
];

/**
 * Curated premium ACP agents: the registry entries that are not free to start.
 * They stay installable from the Premium tab; the note says what the user will
 * be asked for (paid plan, trial credits, region, or a BYO key).
 */
export interface PremiumAgent {
  /** Agent id in the official ACP registry. */
  readonly id: string;
  /** Display name used before the registry answers. */
  readonly name: string;
  /** One line about what the agent is. */
  readonly summary: string;
  /** Why it is premium, phrased as a fact. */
  readonly premiumNote: string;
  readonly tier: "premium";
  /** Official pricing/docs page; the live registry fills this when omitted. */
  readonly docsUrl?: string;
  /** Region restrictions, only when the vendor documents them. */
  readonly availability?: AgentAvailability;
}

export const PREMIUM_AGENTS: readonly PremiumAgent[] = [
  {
    id: "agoragentic-acp",
    name: "Agoragentic",
    summary: "Agent marketplace gateway for ACP.",
    premiumNote: "Requires an Agoragentic account and paid usage.",
    tier: "premium",
  },
  {
    id: "auggie",
    name: "Auggie CLI",
    summary: "Augment Code's terminal agent.",
    premiumNote: "Requires an Augment Code plan; trial credits available.",
    tier: "premium",
    docsUrl: "https://www.augmentcode.com/",
  },
  {
    id: "claude-acp",
    name: "Claude Agent",
    summary: "Anthropic's Claude Code agent.",
    premiumNote: "Requires a Claude subscription or an Anthropic API key.",
    tier: "premium",
    docsUrl: "https://claude.com/pricing",
  },
  {
    id: "corust-agent",
    name: "Corust Agent",
    summary: "Corust's coding agent.",
    premiumNote: "Requires a Corust account/plan.",
    tier: "premium",
  },
  {
    id: "dimcode",
    name: "DimCode",
    summary: "Proprietary DimAgent with BYO model providers.",
    premiumNote: "Paid DimAgent plan; bring your own model provider keys.",
    tier: "premium",
    docsUrl: "https://www.dimcode.dev/",
  },
  {
    id: "factory-droid",
    name: "Factory Droid",
    summary: "Factory's agentic coding CLI.",
    premiumNote: "Requires a Factory account; paid plans with trial credits.",
    tier: "premium",
    docsUrl: "https://factory.ai/",
  },
  {
    id: "glm-acp-agent",
    name: "GLM Agent",
    summary: "Z.ai's GLM coding agent.",
    premiumNote: "Requires a Z.ai GLM coding plan or API key.",
    tier: "premium",
    docsUrl: "https://z.ai/",
  },
  {
    id: "kimchi",
    name: "Kimchi",
    summary: "Kimchi's coding agent.",
    premiumNote: "Requires a Kimchi account/plan.",
    tier: "premium",
  },
  {
    id: "minimax-code",
    name: "MiniMax Code",
    summary: "MiniMax's coding agent.",
    premiumNote:
      "Requires a MiniMax account/plan. Sign-in was reported to fail from Cyprus; kept as an option for other regions.",
    tier: "premium",
    docsUrl: "https://platform.minimax.io/docs/m-plan/minimax-code",
    availability: {
      reportedBlockedCountries: ["CY"],
      note: "Reported sign-in failure from Cyprus. MiniMax publishes no country restriction (only a sanctions clause), so this is UNVERIFIED — an undocumented block, not policy.",
      sourceUrl: "https://platform.minimax.io/docs/guides/terms-of-service.md",
    },
  },
  {
    id: "minion-code",
    name: "Minion Code",
    summary: "Minion's coding agent.",
    premiumNote: "Requires a Minion account/plan.",
    tier: "premium",
  },
  {
    id: "nova",
    name: "Nova",
    summary: "Nova coding agent.",
    premiumNote: "An option for some accounts/regions; requires a Nova subscription.",
    tier: "premium",
  },
  {
    id: "poolside",
    name: "Poolside",
    summary: "Poolside's coding agent.",
    premiumNote: "Requires a Poolside account; paid/enterprise access.",
    tier: "premium",
    docsUrl: "https://poolside.ai/",
  },
  {
    id: "amp-acp",
    name: "Amp",
    summary: "Sourcegraph's frontier coding agent.",
    premiumNote:
      "Hobby plan is $0 only with your own keys or subscription; hosted usage is pay-as-you-go.",
    tier: "premium",
    docsUrl: "https://ampcode.com/pricing",
  },
  {
    id: "autohand",
    name: "Autohand Code",
    summary: "Open-source agent with broad provider support.",
    premiumNote: "Open-source CLI; use provider keys or local models.",
    tier: "premium",
    docsUrl: "https://www.autohand.ai/cli/",
  },
  {
    id: "bob",
    name: "IBM Bob",
    summary: "IBM's AI development partner.",
    premiumNote: "IBM Bob: free 30-day trial with 50 Bobcoins; Pro from $20/mo after.",
    tier: "premium",
    docsUrl: "https://bob.ibm.com/pricing",
  },
  {
    id: "cortex-code",
    name: "Cortex Code",
    summary: "Snowflake's Cortex coding agent.",
    premiumNote: "Trial only: a paid Snowflake account is required for CoCo CLI.",
    tier: "premium",
    docsUrl: "https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli",
  },
  {
    id: "crow-cli",
    name: "crow-cli",
    summary: "Open-source agent for the terminal.",
    premiumNote: "Open-source agent; bring your own keys and models.",
    tier: "premium",
    docsUrl: "https://crow-ai.dev",
  },
  {
    id: "deepagents",
    name: "DeepAgents",
    summary: "LangChain's deep agent harness.",
    premiumNote: "Open-source harness; model-agnostic, bring your own LLM key.",
    tier: "premium",
    docsUrl: "https://github.com/langchain-ai/deepagents",
  },
  {
    id: "dirac",
    name: "Dirac",
    summary: "Open-source coding agent.",
    premiumNote: "Open-source agent; connect your own model provider key.",
    tier: "premium",
    docsUrl: "https://dirac.run",
  },
  {
    id: "fast-agent",
    name: "fast-agent",
    summary: "Composable agent framework with an ACP mode.",
    premiumNote: "Open-source framework; bring your own model provider key.",
    tier: "premium",
    docsUrl: "https://github.com/evalstate/fast-agent",
  },
  {
    id: "goose",
    name: "goose",
    summary: "Block's open-source local agent.",
    premiumNote:
      "Open-source agent; model usage needs your own API keys or existing subscriptions.",
    tier: "premium",
    docsUrl: "https://goose-docs.ai/",
  },
  {
    id: "harn",
    name: "Harn",
    summary: "Agent language and runtime with an ACP bridge.",
    premiumNote: "Open-source runtime; use local or hosted models with your keys.",
    tier: "premium",
    docsUrl: "https://harnlang.com",
  },
  {
    id: "kimi",
    name: "Kimi CLI",
    summary: "Moonshot's coding CLI.",
    premiumNote: "Open-source CLI; needs a Kimi Code subscription, API key or BYO provider key.",
    tier: "premium",
    docsUrl: "https://moonshotai.github.io/kimi-code/en/guides/getting-started",
  },
  {
    id: "pi-acp",
    name: "pi",
    summary: "Open-source coding agent with an ACP adapter.",
    premiumNote: "Open-source agent; connect your own subscription or API key.",
    tier: "premium",
    docsUrl: "https://github.com/earendil-works/pi",
  },
  {
    id: "qwen-code",
    name: "Qwen Code",
    summary: "Alibaba's open coding agent with an ACP bridge.",
    premiumNote:
      "Open-source CLI; the Qwen OAuth free tier ended 2026-04-15, so bring your own key.",
    tier: "premium",
    docsUrl: "https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/",
  },
  {
    id: "stakpak",
    name: "Stakpak",
    summary: "Open-source DevOps agent in Rust.",
    premiumNote: "Open-source core; BYO keys or local models; hosted from $15/mo.",
    tier: "premium",
    docsUrl: "https://stakpak.dev/pricing",
  },
  {
    id: "vtcode",
    name: "VT Code",
    summary: "Open-source agent with provider failover.",
    premiumNote: "Open-source Rust agent; bring your own provider API keys.",
    tier: "premium",
    docsUrl: "https://github.com/vinhnx/VTCode",
  },
];

/**
 * Time zones that identify a country unambiguously enough to fall back on when
 * the locale carries no region (e.g. a bare "en"). Deliberately small: only
 * zones whose country is the same for every area inside them.
 */
const COUNTRY_BY_TIME_ZONE: Readonly<Record<string, string>> = {
  "Asia/Nicosia": "CY",
  "Europe/Athens": "GR",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Berlin": "DE",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "Europe/Lisbon": "PT",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Singapore": "SG",
  "Australia/Sydney": "AU",
};

export function regionCountryFromTimeZone(timeZone: string): string | null {
  return COUNTRY_BY_TIME_ZONE[timeZone] ?? null;
}

/**
 * The user's country from a BCP 47 locale, falling back to the runtime time
 * zone when the locale has no region ("en", "el"). Returns null when neither
 * can identify a country.
 */
export function regionCountryFromLocale(locale: string): string | null {
  const segments = locale.trim().split(/[-_]/u);
  for (const segment of segments.slice(1)) {
    // Locale extensions (u-, x-) are not regions; stop before them.
    if (segment.toLowerCase() === "u" || segment.toLowerCase() === "x") break;
    if (/^[A-Za-z]{2}$/u.test(segment)) return segment.toUpperCase();
  }
  return null;
}

/**
 * The best country guess for this device: the time zone first (it tracks where
 * the machine actually is, while the locale often stays en-US after moving),
 * then the locale's region subtag.
 */
export function detectRegionCountry(): string | null {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fromTimeZone = regionCountryFromTimeZone(timeZone);
  if (fromTimeZone !== null) return fromTimeZone;
  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    return regionCountryFromLocale(navigator.language);
  }
  return null;
}

export type AgentAvailabilityStatus =
  | "available"
  | "unavailable"
  | "reported-unavailable"
  | "unknown";

/**
 * Whether an agent can be used from `country`. Unknown is the default: an entry
 * with no documented restriction is not evidence of availability.
 */
export function agentAvailability(
  entry: { readonly availability?: AgentAvailability | undefined },
  country: string | null,
): AgentAvailabilityStatus {
  if (country === null) return "unknown";
  const availability = entry.availability;
  if (availability === undefined) return "unknown";
  const target = country.trim().toUpperCase();
  if (availability.blockedCountries?.some((blocked) => blocked.toUpperCase() === target) === true) {
    return "unavailable";
  }
  if (
    availability.reportedBlockedCountries?.some((blocked) => blocked.toUpperCase() === target) ===
    true
  ) {
    return "reported-unavailable";
  }
  if (availability.countries === undefined) return "unknown";
  return availability.countries.some((allowed) => allowed.toUpperCase() === target)
    ? "available"
    : "unavailable";
}

export function findFreemiumAgent(id: string): FreemiumAgent | undefined {
  return FREEMIUM_AGENTS.find((agent) => agent.id === id);
}

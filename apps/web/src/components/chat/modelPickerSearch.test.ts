import { describe, expect, it } from "vite-plus/test";

import {
  buildModelPickerSearchText,
  modelPickerVendor,
  rankModelPickerSearch,
  scoreModelPickerSearch,
} from "./modelPickerSearch";

describe("buildModelPickerSearchText", () => {
  it("builds provider-agnostic search text from generic fields", () => {
    expect(
      buildModelPickerSearchText({
        driverKind: "opencode",
        providerDisplayName: "opencode",
        name: "Claude Opus 4.7",
        subProvider: "GitHub Copilot",
      }),
    ).toBe("claude opus 4.7 github copilot opencode opencode");
  });
});

describe("scoreModelPickerSearch", () => {
  it("matches typo-tolerant multi-token queries", () => {
    expect(
      scoreModelPickerSearch(
        {
          driverKind: "opencode",
          providerDisplayName: "opencode",
          name: "Claude Opus 4.7",
          subProvider: "GitHub Copilot",
        },
        "coplt op",
      ),
    ).not.toBeNull();
  });

  it("rejects results when any query token does not match", () => {
    expect(
      scoreModelPickerSearch(
        {
          driverKind: "codex",
          providerDisplayName: "codex",
          name: "GPT-5 Codex",
        },
        "coplt op",
      ),
    ).toBeNull();
  });

  it("ranks exact token matches ahead of fuzzier matches", () => {
    const exactScore = scoreModelPickerSearch(
      {
        driverKind: "opencode",
        providerDisplayName: "opencode",
        name: "Claude Opus 4.7",
        subProvider: "GitHub Copilot",
      },
      "copilot opus",
    );
    const fuzzyScore = scoreModelPickerSearch(
      {
        driverKind: "opencode",
        providerDisplayName: "opencode",
        name: "Claude Opus 4.7",
        subProvider: "GitHub Copilot",
      },
      "coplt op",
    );

    expect(exactScore).not.toBeNull();
    expect(fuzzyScore).not.toBeNull();
    expect(exactScore!).toBeLessThan(fuzzyScore!);
  });

  it("gives favorite models a strong enough ranking boost for partial queries", () => {
    const favoriteScore = scoreModelPickerSearch(
      {
        driverKind: "claudeAgent",
        providerDisplayName: "Claude",
        name: "Claude Opus 4.7",
        isFavorite: true,
      },
      "opu",
    );
    const nonFavoriteScore = scoreModelPickerSearch(
      {
        driverKind: "cursor",
        providerDisplayName: "Cursor",
        name: "Opus 4.5",
      },
      "opu",
    );

    expect(favoriteScore).not.toBeNull();
    expect(nonFavoriteScore).not.toBeNull();
    expect(favoriteScore!).toBeLessThan(nonFavoriteScore!);
  });

  it("does not let the favorite boost outrank clearly better textual matches", () => {
    const favoriteScore = scoreModelPickerSearch(
      {
        driverKind: "claudeAgent",
        providerDisplayName: "Claude",
        name: "Claude Opus 4.7",
        isFavorite: true,
      },
      "opus 4.7",
    );
    const nonFavoriteExactScore = scoreModelPickerSearch(
      {
        driverKind: "cursor",
        providerDisplayName: "Cursor",
        name: "Opus 4.7",
      },
      "opus 4.7",
    );

    expect(favoriteScore).not.toBeNull();
    expect(nonFavoriteExactScore).not.toBeNull();
    expect(nonFavoriteExactScore!).toBeLessThan(favoriteScore!);
  });

  it("matches a custom instance's display name against its models", () => {
    expect(
      scoreModelPickerSearch(
        {
          driverKind: "codex",
          providerDisplayName: "Codex Personal",
          name: "GPT-5 Codex",
        },
        "personal",
      ),
    ).not.toBeNull();
  });
});

type CatalogModel = {
  driverKind: string;
  providerDisplayName: string;
  name: string;
  subProvider?: string;
  isFavorite?: boolean;
};

function instanceModels(
  driverKind: string,
  providerDisplayName: string,
  names: ReadonlyArray<string>,
): CatalogModel[] {
  return names.map((name) => ({ driverKind, providerDisplayName, name }));
}

const catalog: CatalogModel[] = [
  ...instanceModels("claudeAgent", "Claude", [
    "Claude Opus 5.5",
    "Claude Sonnet 5.5",
    "Claude Fable 5.1",
    "Claude Fable 5",
    "Claude Opus 5",
    "Claude Opus 4.8",
    "Claude Opus 4.7",
    "Claude Opus 4.6",
    "Claude Opus 4.5",
    "Claude Sonnet 5",
    "Claude Sonnet 4.6",
    "Claude Haiku 5.5",
    "Claude Haiku 4.5",
  ]),
  ...instanceModels("codex", "Codex", [
    "GPT-6.1 Sol",
    "GPT-6 Astra",
    "GPT-6 Luna",
    "GPT-6 Sol",
    "GPT-5.6 Sol",
    "GPT-5.6 Terra",
    "GPT-5.6 Luna",
    "GPT-5.5",
  ]),
  ...instanceModels("grok", "Grok", ["Grok 4.7", "Grok 4.6", "Grok 4.5"]),
  ...instanceModels("antigravity", "Antigravity", [
    "Gemini 3.8 Flash (High)",
    "Gemini 3.8 Flash (Medium)",
    "Gemini 3.8 Flash (Low)",
    "Gemini 3.7 Flash (High)",
    "Gemini 3.7 Flash (Medium)",
    "Gemini 3.7 Flash (Low)",
    "Gemini 3.6 Flash (High)",
    "Gemini 3.6 Flash (Medium)",
    "Gemini 3.6 Flash (Low)",
    "Gemini 3.1 Pro (High)",
    "Gemini 3.1 Pro (Low)",
  ]),
  {
    driverKind: "opencode",
    providerDisplayName: "OpenCode",
    name: "Kimi K3",
    subProvider: "Moonshot",
  },
  {
    driverKind: "opencode",
    providerDisplayName: "OpenCode",
    name: "Kimi K2.5",
    subProvider: "Moonshot",
  },
  {
    driverKind: "opencode",
    providerDisplayName: "OpenCode",
    name: "Kimi K2",
    subProvider: "Moonshot",
  },
];

function search(query: string, models: ReadonlyArray<CatalogModel> = catalog): string[] {
  return rankModelPickerSearch(models, query, (model) => model).map((model) => model.name);
}

describe("rankModelPickerSearch", () => {
  it.each([
    [
      "opus",
      [
        "Claude Opus 5.5",
        "Claude Opus 5",
        "Claude Opus 4.8",
        "Claude Opus 4.7",
        "Claude Opus 4.6",
        "Claude Opus 4.5",
      ],
    ],
    ["sonnet", ["Claude Sonnet 5.5", "Claude Sonnet 5", "Claude Sonnet 4.6"]],
    ["fable", ["Claude Fable 5.1", "Claude Fable 5"]],
    ["haiku", ["Claude Haiku 5.5", "Claude Haiku 4.5"]],
    [
      "gpt",
      [
        "GPT-6.1 Sol",
        "GPT-6 Astra",
        "GPT-6 Luna",
        "GPT-6 Sol",
        "GPT-5.6 Sol",
        "GPT-5.6 Terra",
        "GPT-5.6 Luna",
        "GPT-5.5",
      ],
    ],
    ["sol", ["GPT-6.1 Sol", "GPT-6 Sol", "GPT-5.6 Sol"]],
    ["luna", ["GPT-6 Luna", "GPT-5.6 Luna"]],
    ["grok", ["Grok 4.7", "Grok 4.6", "Grok 4.5"]],
    [
      "flash",
      [
        "Gemini 3.8 Flash (High)",
        "Gemini 3.8 Flash (Medium)",
        "Gemini 3.8 Flash (Low)",
        "Gemini 3.7 Flash (High)",
        "Gemini 3.7 Flash (Medium)",
        "Gemini 3.7 Flash (Low)",
        "Gemini 3.6 Flash (High)",
        "Gemini 3.6 Flash (Medium)",
        "Gemini 3.6 Flash (Low)",
      ],
    ],
    ["kimi", ["Kimi K3", "Kimi K2.5", "Kimi K2"]],
  ])("lists equally good matches for %j newest first", (query, expected) => {
    expect(search(query).slice(0, expected.length)).toEqual(expected);
  });

  it("keeps newest first when a version token narrows the family", () => {
    expect(search("opus 4")).toEqual([
      "Claude Opus 4.8",
      "Claude Opus 4.7",
      "Claude Opus 4.6",
      "Claude Opus 4.5",
    ]);
    expect(search("opus 5")).toEqual(["Claude Opus 5.5", "Claude Opus 5", "Claude Opus 4.5"]);
    // Trailing punctuation is folded away, so "opus 5." is the same query as
    // "opus 5" — the whole family, newest first, not a single model.
    expect(search("opus 5.")).toEqual(["Claude Opus 5.5", "Claude Opus 5", "Claude Opus 4.5"]);
  });

  it("still ranks an exact name above newer models that extend it", () => {
    expect(search("gpt-6 sol").slice(0, 2)).toEqual(["GPT-6 Sol", "GPT-6.1 Sol"]);
    expect(search("claude opus 5").slice(0, 2)).toEqual(["Claude Opus 5", "Claude Opus 5.5"]);
    expect(search("Grok 4.6")[0]).toBe("Grok 4.6");
  });

  it("matches an exact name regardless of extra whitespace in the query", () => {
    expect(search("  claude   opus 5 ")[0]).toBe("Claude Opus 5");
  });

  it("ranks an exact name above a favorite partial match", () => {
    const models = catalog.map((model) =>
      model.name === "Claude Opus 5.5" ? { ...model, isFavorite: true } : model,
    );
    expect(search("claude opus 5", models)[0]).toBe("Claude Opus 5");
  });

  it("matches the provider when the name does not", () => {
    expect(search("moonshot")).toEqual(["Kimi K3", "Kimi K2.5", "Kimi K2"]);
  });

  it("ranks a favorite above newer models in the same family", () => {
    const models = catalog.map((model) =>
      model.name === "Claude Opus 4.5" ? { ...model, isFavorite: true } : model,
    );
    expect(search("opus", models).slice(0, 3)).toEqual([
      "Claude Opus 4.5",
      "Claude Opus 5.5",
      "Claude Opus 5",
    ]);
  });

  it("follows the order it is given, including a user's custom model order", () => {
    expect(search("grok", catalog.toReversed())).toEqual(["Grok 4.5", "Grok 4.6", "Grok 4.7"]);
  });
});

/**
 * A real slice of the Hermes ACP catalog: one gateway (OpenRouter) re-exports
 * thousands of vendor models under `vendor/family-version` ids, so the name is
 * `OpenRouter · anthropic/claude-opus-5.5` and the vendor is only visible in the
 * id. These are the queries that used to be awkward.
 */
type GatewayModel = {
  driverKind: string;
  providerDisplayName: string;
  name: string;
  subProvider: string;
  slug: string;
};

const gatewayModels: GatewayModel[] = [
  ["OpenRouter · anthropic/claude-opus-5.5", "openrouter:anthropic/claude-opus-5.5"],
  ["OpenRouter · anthropic/claude-opus-4.8", "openrouter:anthropic/claude-opus-4.8"],
  ["OpenRouter · anthropic/claude-sonnet-5.5", "openrouter:anthropic/claude-sonnet-5.5"],
  ["OpenRouter · anthropic/claude-haiku-4.5", "openrouter:anthropic/claude-haiku-4.5"],
  ["OpenRouter · openai/gpt-6.1-sol", "openrouter:openai/gpt-6.1-sol"],
  ["OpenRouter · openai/gpt-6-astra", "openrouter:openai/gpt-6-astra"],
  ["OpenRouter · openai/gpt-6-sol", "openrouter:openai/gpt-6-sol"],
  ["OpenRouter · google/gemini-3.8-flash", "openrouter:google/gemini-3.8-flash"],
  ["OpenRouter · google/gemini-3.1-pro-preview", "openrouter:google/gemini-3.1-pro-preview"],
  ["OpenRouter · qwen/qwen3.8-max-0902", "openrouter:qwen/qwen3.8-max-0902"],
  ["OpenRouter · qwen/qwen3.8-flash", "openrouter:qwen/qwen3.8-flash"],
  ["OpenRouter · deepseek/deepseek-v4.1-flash", "openrouter:deepseek/deepseek-v4.1-flash"],
  ["OpenRouter · deepseek/deepseek-v4-pro", "openrouter:deepseek/deepseek-v4-pro"],
  ["OpenRouter · x-ai/grok-4.7", "openrouter:x-ai/grok-4.7"],
  ["NVIDIA NIM · google/codegemma-1.1-7b", "nvidia:google/codegemma-1.1-7b"],
  ["NVIDIA NIM · mistralai/mistral-large-2-instruct", "nvidia:mistralai/mistral-large-2-instruct"],
].map(([name, slug]) => {
  const modelName = name ?? "";
  return {
    driverKind: "hermes",
    providerDisplayName: modelName.startsWith("NVIDIA") ? "NVIDIA NIM" : "Hermes",
    name: modelName,
    subProvider: modelName.startsWith("NVIDIA") ? "NVIDIA NIM" : "OpenRouter",
    slug: slug ?? "",
  };
});

function searchGateway(query: string): string[] {
  return rankModelPickerSearch(gatewayModels, query, (model) => model).map((model) => model.slug);
}

describe("modelPickerVendor", () => {
  it.each([
    ["openrouter:anthropic/claude-opus-5.5", "anthropic"],
    ["nvidia:google/codegemma-1.1-7b", "google"],
    ["omniroute:aihorde/some-model", "aihorde"],
    ["claude-opus-4.7", undefined],
    ["gpt-5.6", undefined],
  ])("reads the vendor out of %s", (slug, vendor) => {
    expect(modelPickerVendor(slug)).toBe(vendor);
  });
});

describe("gateway model search", () => {
  it("ranks a version query at the model that matches it", () => {
    expect(searchGateway("opus 4.8")[0]).toBe("openrouter:anthropic/claude-opus-4.8");
    expect(searchGateway("gpt 6.1")[0]).toBe("openrouter:openai/gpt-6.1-sol");
    expect(searchGateway("grok 4.7")[0]).toBe("openrouter:x-ai/grok-4.7");
    expect(searchGateway("deepseek v4.1 flash")[0]).toBe("openrouter:deepseek/deepseek-v4.1-flash");
  });

  it("treats dashes, spaces, dots and no separators as the same query", () => {
    const variants = ["claude-opus-5.5", "claude opus 5.5", "claude.opus.5.5", "claudeopus55"];
    for (const variant of variants) {
      expect(searchGateway(variant)[0]).toBe("openrouter:anthropic/claude-opus-5.5");
    }
  });

  it("finds a vendor that only appears in the model id", () => {
    expect(searchGateway("anthropic opus")[0]).toBe("openrouter:anthropic/claude-opus-5.5");
    expect(searchGateway("mistralai")).toEqual(["nvidia:mistralai/mistral-large-2-instruct"]);
    expect(searchGateway("google")).toEqual([
      "openrouter:google/gemini-3.8-flash",
      "openrouter:google/gemini-3.1-pro-preview",
      "nvidia:google/codegemma-1.1-7b",
    ]);
  });

  it("matches a model id typed the way the gateway writes it", () => {
    expect(searchGateway("openrouter:qwen/qwen3.8-flash")[0]).toBe("openrouter:qwen/qwen3.8-flash");
  });
});

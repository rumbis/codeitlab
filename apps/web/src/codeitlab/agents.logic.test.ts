import {
  ProviderDriverKind,
  type AcpRegistrySearchAgent,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@codeitlab/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  agentHealth,
  deriveFreemiumInstanceId,
  installFreemiumAgent,
  installedFreemiumAgents,
  mergeFreemiumCards,
  mergeOtherAgentCards,
  mergePremiumCards,
} from "./agents.logic";
import { FREEMIUM_AGENTS, PREMIUM_AGENTS } from "./freemiumAgents";

function registryAgent(id: string, version: string): AcpRegistrySearchAgent {
  return {
    id,
    name: `${id} display`,
    version,
    description: `${id} description`,
    authors: [],
    license: "MIT",
    website: null,
    repository: null,
    icon: `https://cdn.agentclientprotocol.com/registry/v1/latest/${id}.svg`,
    distribution: "npx",
    integrity: "registry",
  };
}

const instance = (overrides: Partial<ProviderInstanceConfig>): ProviderInstanceConfig =>
  ({
    driver: "acpRegistry",
    enabled: true,
    ...overrides,
  }) as ProviderInstanceConfig;

describe("installedFreemiumAgents", () => {
  it("maps registry instances to their agent ids", () => {
    const installed = installedFreemiumAgents({
      acpRegistry_gemini: instance({ config: { source: "registry", agentId: "gemini" } }),
      acpRegistry_goose: instance({ config: { agentId: "goose" } }),
      claudeAgent: instance({ driver: ProviderDriverKind.make("claudeAgent") }),
      acpRegistry_local: instance({ config: { source: "local", commandPath: "npx" } }),
      acpRegistry_broken: instance({ config: {} }),
    });
    expect([...installed.entries()]).toEqual([
      ["gemini", "acpRegistry_gemini"],
      ["goose", "acpRegistry_goose"],
    ]);
  });

  it("handles missing instance records", () => {
    expect(installedFreemiumAgents(undefined).size).toBe(0);
    expect(installedFreemiumAgents({}).size).toBe(0);
  });
});

describe("deriveFreemiumInstanceId", () => {
  it("slugs the agent id and keeps it unique", () => {
    expect(deriveFreemiumInstanceId("gemini", new Set())).toBe("acpRegistry_gemini");
    expect(deriveFreemiumInstanceId("factory-droid", new Set())).toBe("acpRegistry_factory_droid");
    expect(deriveFreemiumInstanceId("gemini", new Set(["acpRegistry_gemini"]))).toBe(
      "acpRegistry_gemini_2",
    );
    expect(
      deriveFreemiumInstanceId("gemini", new Set(["acpRegistry_gemini", "acpRegistry_gemini_2"])),
    ).toBe("acpRegistry_gemini_3");
  });

  it("stays a valid instance id for odd agent ids", () => {
    const id = deriveFreemiumInstanceId("a".repeat(80), new Set());
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
  });
});

describe("mergeFreemiumCards", () => {
  it("prefers live registry metadata and marks installed agents", () => {
    const cards = mergeFreemiumCards({
      registry: [registryAgent("cursor", "1.2.3")],
      installed: new Map([["cursor", "acpRegistry_cursor"]]),
      installingId: "sigit",
      iconFor: () => "https://cdn.agentclientprotocol.com/registry/v1/latest/fallback.svg",
      providers: null,
    });
    const cursor = cards.find((card) => card.id === "cursor");
    expect(cursor?.name).toBe("cursor display");
    expect(cursor?.version).toBe("1.2.3");
    expect(cursor?.installed).toBe(true);
    expect(cursor?.instanceId).toBe("acpRegistry_cursor");

    const sigit = cards.find((card) => card.id === "sigit");
    expect(sigit?.installing).toBe(true);
    expect(sigit?.installed).toBe(false);
    expect(sigit?.icon).toBe("https://cdn.agentclientprotocol.com/registry/v1/latest/fallback.svg");
  });

  it("falls back to the curated copy when the registry is empty", () => {
    const cards = mergeFreemiumCards({
      registry: null,
      installed: new Map(),
      installingId: null,
      iconFor: () => null,
      providers: null,
    });
    expect(cards).toHaveLength(FREEMIUM_AGENTS.length);
    expect(cards.every((card) => card.version === null)).toBe(true);
  });
});

describe("mergePremiumCards", () => {
  it("prefers live registry metadata and keeps curated notes", () => {
    const cards = mergePremiumCards({
      registry: [registryAgent("goose", "1.2.3")],
      installed: new Map([["goose", "acpRegistry_goose"]]),
      installingId: "minimax-code",
      iconFor: () => "https://cdn.agentclientprotocol.com/registry/v1/latest/fallback.svg",
      providers: null,
    });
    expect(cards).toHaveLength(PREMIUM_AGENTS.length);

    const goose = cards.find((card) => card.id === "goose");
    expect(goose?.tier).toBe("premium");
    expect(goose?.name).toBe("goose display");
    expect(goose?.version).toBe("1.2.3");
    expect(goose?.installed).toBe(true);
    expect(goose?.instanceId).toBe("acpRegistry_goose");
    expect(goose?.docsUrl).toBe("https://goose-docs.ai/");

    const minimax = cards.find((card) => card.id === "minimax-code");
    expect(minimax?.installing).toBe(true);
    expect(minimax?.installed).toBe(false);
    expect(minimax?.availability?.reportedBlockedCountries).toContain("CY");
  });

  it("fills the docs link from the registry when the curated entry has none", () => {
    const cards = mergePremiumCards({
      registry: [
        {
          ...registryAgent("agoragentic-acp", "1.0.0"),
          website: "https://agoragentic.example",
        },
      ],
      installed: new Map(),
      installingId: null,
      iconFor: () => null,
      providers: null,
    });
    expect(cards.find((card) => card.id === "agoragentic-acp")?.docsUrl).toBe(
      "https://agoragentic.example",
    );
    expect(cards.find((card) => card.id === "corust-agent")?.docsUrl).toBeNull();
  });
});

describe("mergeOtherAgentCards", () => {
  it("lists non-curated registry agents alphabetically and marks installed ones", () => {
    const other = mergeOtherAgentCards({
      registry: [
        registryAgent("zeta-agent", "1.0.0"),
        registryAgent("alpha-agent", "2.0.0"),
        registryAgent("crow-cli", "9.9.9"),
        registryAgent("gemini", "3.0.0"),
      ],
      installed: new Map([["alpha-agent", "acpRegistry_alpha_agent"]]),
      installingId: "zeta-agent",
      providers: null,
    });
    expect(other.map((agent) => agent.id)).toEqual(["alpha-agent", "zeta-agent"]);
    expect(other[0]?.installed).toBe(true);
    expect(other[0]?.instanceId).toBe("acpRegistry_alpha_agent");
    expect(other[1]?.installing).toBe(true);
    expect(other[1]?.docsUrl).toBeNull();
  });
});

describe("installFreemiumAgent", () => {
  const agent = { id: "crow-cli", name: "crow-cli" };
  const success = () => AsyncResult.success(undefined);
  const failure = (message: string) => AsyncResult.failure(Cause.fail(new Error(message)));

  it("prepares the agent and creates an enabled registry instance", async () => {
    const prepare = vi.fn(async () => success());
    const createInstance = vi.fn(async () => success());
    const outcome = await installFreemiumAgent({
      agent,
      existingIds: new Set(["acpRegistry_crow_cli"]),
      prepare,
      createInstance,
    });
    expect(outcome).toEqual({ ok: true, instanceId: "acpRegistry_crow_cli_2" });
    expect(prepare).toHaveBeenCalledWith("crow-cli");
    expect(createInstance).toHaveBeenCalledWith("acpRegistry_crow_cli_2", {
      driver: "acpRegistry",
      enabled: true,
      displayName: "crow-cli",
      config: { source: "registry", agentId: "crow-cli", distribution: "auto" },
    });
  });

  it("does not create an instance when the download fails", async () => {
    const createInstance = vi.fn(async () => success());
    const outcome = await installFreemiumAgent({
      agent,
      existingIds: new Set(),
      prepare: async () => failure("npm install failed"),
      createInstance,
    });
    expect(outcome).toEqual({ ok: false, message: "npm install failed" });
    expect(createInstance).not.toHaveBeenCalled();
  });

  it("reports the create failure and keeps the prepared download", async () => {
    const outcome = await installFreemiumAgent({
      agent,
      existingIds: new Set(),
      prepare: async () => success(),
      createInstance: async () => failure("instance id already exists"),
    });
    expect(outcome).toEqual({ ok: false, message: "instance id already exists" });
  });

  it("labels an interrupted install", async () => {
    const outcome = await installFreemiumAgent({
      agent,
      existingIds: new Set(),
      prepare: async () => AsyncResult.failure(Cause.interrupt()),
      createInstance: async () => success(),
    });
    expect(outcome).toEqual({ ok: false, message: "The install was interrupted." });
  });
});

function provider(overrides: Partial<ServerProvider>): ServerProvider {
  return {
    instanceId: "acpRegistry_cursor",
    driver: ProviderDriverKind.make("acpRegistry"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-23T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  } as ServerProvider;
}

describe("agentHealth", () => {
  it("maps provider state to a card health", () => {
    expect(agentHealth(undefined)).toBeNull();
    expect(agentHealth(provider({}))).toBe("ready");
    expect(agentHealth(provider({ auth: { status: "unauthenticated" } }))).toBe("sign-in");
    expect(agentHealth(provider({ status: "warning" }))).toBe("attention");
    expect(
      agentHealth(provider({ status: "warning", message: "Please sign in to continue." })),
    ).toBe("sign-in");
    expect(agentHealth(provider({ installed: false }))).toBe("attention");
    expect(
      agentHealth(
        provider({
          status: "warning",
          message: 'Sign in in provider settings using "Sign in with Cline".',
          auth: {
            status: "unknown",
            action: {
              elicitationId: "elicitation-1",
              url: "https://cline.example/auth",
              message: "Sign in with Cline",
            },
          },
        }),
      ),
    ).toBe("sign-in");
    expect(agentHealth(provider({ status: "error" }))).toBe("attention");
    expect(agentHealth(provider({ enabled: false }))).toBe("disabled");
  });

  it("carries the provider message onto the card", () => {
    const cards = mergeFreemiumCards({
      registry: null,
      installed: new Map([["cursor", "acpRegistry_cursor"]]),
      installingId: null,
      iconFor: () => null,
      providers: new Map([
        [
          "acpRegistry_cursor",
          provider({ status: "warning", message: "The ACP agent could not create a test session" }),
        ],
      ]),
    });
    const cursor = cards.find((card) => card.id === "cursor");
    expect(cursor?.health).toBe("attention");
    expect(cursor?.healthMessage).toBe("The ACP agent could not create a test session");
  });
});

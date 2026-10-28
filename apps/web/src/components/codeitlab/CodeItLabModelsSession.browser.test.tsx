import type { CodeItLabContextSettings } from "@codeitlab/core/context";
import type { CodeItLabModelsSettings } from "@codeitlab/core/models";
import {
  EnvironmentId,
  type CodeItLabRoutingSettings,
  type RoutingCatalog,
  type RoutingDecision,
  type RoutingHealth,
} from "@codeitlab/contracts";
import { RegistryContext } from "@effect/atom-react";
import type { Atom } from "effect/reactivity";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { act, render as renderUi } from "../../../test/render";
import { HEURISTIC_NOTE, NO_DECISION_REASON } from "../../codeitlab/modelsSession";
import { CodeItLabModelsPage } from "./CodeItLabModelsPage";

const CHECKED_AT = "2026-10-25T08:00:00.000Z";

const mock = vi.hoisted(() => ({
  routing: null as unknown,
  credentials: null as unknown,
  probe: vi.fn(),
  models: null as unknown as CodeItLabModelsSettings,
  routingSettings: null as unknown as CodeItLabRoutingSettings,
  context: { sizes: [] } as CodeItLabContextSettings,
  updates: [] as unknown[],
  providerModelPreferences: {} as Record<string, { hiddenModels: string[] }>,
  updateModelPreferences: vi.fn(async (_patch: unknown) => undefined),
  presentations: null as unknown as Atom.Writable<ReadonlyMap<EnvironmentId, unknown>>,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabRouting: (() => mock.routing) as never,
  useCodeItLabCredentials: (() => mock.credentials) as never,
  useCodeItLabModelEndpointProbe: (() => mock.probe) as never,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: {
      models: mock.models,
      routing: mock.routingSettings,
      context: mock.context,
    },
    environmentId: null,
    update: (patch: unknown) => {
      mock.updates.push(patch);
      return patch;
    },
  })) as never,
}));

vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  usePrimarySettings: (() => ({
    providerModelPreferences: mock.providerModelPreferences,
  })) as never,
  useUpdateEnvironmentModelPreferences: (() => mock.updateModelPreferences) as never,
}));

vi.mock(import("../../state/usage"), async (original) => ({
  ...(await original()),
  useUsage: (() => ({
    merged: {},
    environments: [],
    selectedEnvironments: [],
    isPending: false,
    shown: null,
    isPartial: false,
    refresh: vi.fn(),
  })) as never,
}));

vi.mock(import("../../state/presentation"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const presentations = Atom.make<ReadonlyMap<EnvironmentId, unknown>>(new Map()).pipe(
    Atom.keepAlive,
  );
  mock.presentations = presentations as never;
  return {
    ...actual,
    environmentPresentations: {
      ...actual.environmentPresentations,
      presentationsWithProvidersAtom: presentations as never,
    },
  };
});

const contextProvider = {
  instanceId: "claude",
  driver: "claude",
  displayName: "Claude",
  enabled: true,
  installed: true,
  status: "ready",
  availability: "available",
  models: [
    { slug: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", isCustom: false, capabilities: null },
  ],
};

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => "env-1") as never,
  useEnvironmentProviders: (() => new Map([["env-1", [contextProvider]]])) as never,
}));

import { appAtomRegistry } from "~/rpc/atomRegistry";

function provider(
  overrides: Partial<RoutingCatalog["providers"][number]> = {},
): RoutingCatalog["providers"][number] {
  return {
    providerInstanceId: "codex",
    providerKind: "codex",
    name: "Codex",
    models: ["gpt-5.4"],
    available: true,
    quota: 1,
    speed: 0.8,
    smartness: 0.9,
    ...overrides,
  };
}

function routingView(
  providers: ReadonlyArray<RoutingCatalog["providers"][number]>,
  history: ReadonlyArray<RoutingDecision> = [],
) {
  const catalog: RoutingCatalog = { mode: "auto", providers: [...providers], omniRouteModels: [] };
  const health: RoutingHealth = {
    checkedAt: CHECKED_AT,
    intervalMinutes: 15,
    nextCheckAt: "2026-10-25T08:15:00.000Z",
    source: "scheduled",
    entries: [],
  };
  return {
    data: catalog,
    history,
    health,
    healthSource: "server",
    healthIsPending: false,
    refreshHealth: vi.fn(),
    checkHealth: vi.fn(),
    decide: vi.fn(),
    source: "server",
    error: null,
    isPending: false,
    refresh: vi.fn(),
  };
}

function decision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    id: "decision-1",
    decidedAt: CHECKED_AT,
    taskClass: "coding",
    providerInstanceId: "codex",
    providerKind: "codex",
    model: "gpt-5.4",
    reason: "coding task: gpt-5.4 has the best smartness for the class.",
    candidates: [
      {
        providerInstanceId: "codex",
        providerKind: "codex",
        model: "gpt-5.4",
        quota: 1,
        smartness: 0.9,
        speed: 0.8,
        score: 0.78,
        available: true,
      },
    ],
    ...overrides,
  };
}

function credentialsView(enabled: boolean) {
  return {
    data: { enabled },
    source: "server",
    error: null,
    isPending: false,
    refresh: vi.fn(),
    update: vi.fn(),
    scan: vi.fn(),
    restore: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    downloadModel: vi.fn(),
  };
}

function modelsSettings(overrides: Partial<CodeItLabModelsSettings> = {}): CodeItLabModelsSettings {
  return { endpoints: [], ...overrides };
}

function routingSettings(
  overrides: Partial<CodeItLabRoutingSettings> = {},
): CodeItLabRoutingSettings {
  return {
    mode: "auto",
    enforcement: "prefer",
    weights: { quota: 0.35, smartness: 0.4, speed: 0.25 },
    providerOrder: [],
    allowFallback: true,
    recordHistory: true,
    routePerTask: true,
    taskOverrides: [],
    delegatedProviderKinds: [],
    healthCheckMinutes: 30,
    speedProbe: true,
    speedProbeModelsPerProvider: 3,
    deepScan: true,
    deepScanConcurrency: 8,
    deepScanTimeoutSeconds: 12,
    fallbackOnProviderFailure: true,
    fallbackInstanceId: "",
    fallbackModel: "",
    providerFailureCooldownMinutes: 10,
    omniRoute: {
      enabled: false,
      baseUrl: "http://127.0.0.1:20128",
      apiKeyEnv: "CODEITLAB_OMNIROUTE_API_KEY",
      virtualModels: [],
    },
    ...overrides,
  };
}

function setup(
  options: {
    readonly providers?: ReadonlyArray<RoutingCatalog["providers"][number]>;
    readonly history?: ReadonlyArray<RoutingDecision>;
    readonly models?: CodeItLabModelsSettings;
    readonly providerModelPreferences?: Record<string, { hiddenModels: string[] }>;
  } = {},
) {
  mock.models = options.models ?? modelsSettings();
  mock.routingSettings = routingSettings();
  mock.context = { sizes: [] };
  mock.updates.length = 0;
  mock.providerModelPreferences = options.providerModelPreferences ?? {};
  mock.updateModelPreferences.mockReset();
  mock.updateModelPreferences.mockResolvedValue(undefined);
  mock.probe.mockReset();
  mock.probe.mockResolvedValue(null);
  mock.routing = routingView(options.providers ?? [provider()], options.history ?? []);
  mock.credentials = credentialsView(true);
}

const setPresentations = (
  entries: ReadonlyArray<readonly [EnvironmentId, unknown]>,
): Promise<unknown> =>
  act(async () => {
    appAtomRegistry.set(mock.presentations, new Map(entries));
  });

const pageText = (screen: { readonly container: HTMLElement }): string =>
  screen.container.textContent ?? "";

const sessionText = (screen: { readonly container: HTMLElement }): string =>
  screen.container.querySelector('[data-codeitlab-session-understanding="true"]')?.textContent ??
  "";

const tabLink = (
  screen: { readonly container: HTMLElement },
  id: string,
): HTMLAnchorElement | null =>
  screen.container.querySelector<HTMLAnchorElement>(`[data-codeitlab-models-tab-link="${id}"]`);

const renderPage = (ui: ReactNode, router?: string) =>
  renderUi(
    <RegistryContext.Provider value={appAtomRegistry}>{ui}</RegistryContext.Provider>,
    router === undefined ? undefined : { router },
  );

describe("models page tabs and session understanding", () => {
  it("opens on the Inventory tab", async () => {
    setup();
    await using screen = await renderPage(<CodeItLabModelsPage />);
    await setPresentations([]);

    expect(tabLink(screen, "inventory")?.getAttribute("aria-current")).toBe("page");
    expect(tabLink(screen, "routing")?.getAttribute("aria-current")).toBeNull();
    expect(pageText(screen)).toContain("Models and quota");
    expect(pageText(screen)).toContain("Every model");
  });

  it("renders the Routing tab from its deep link", async () => {
    setup();
    // The route file for /settings/codeitlab/routing renders this same element;
    // the path is set so any Link it renders resolves from the deep link.
    await using screen = await renderPage(
      <CodeItLabModelsPage tab="routing" />,
      "/settings/codeitlab/routing",
    );
    await setPresentations([]);

    expect(tabLink(screen, "routing")?.getAttribute("aria-current")).toBe("page");
    expect(pageText(screen)).toContain("Pick the right harness per task");
    expect(pageText(screen)).not.toContain("Models and quota");
  });

  it("renders the Context tab from its route", async () => {
    setup();
    await using screen = await renderPage(
      <CodeItLabModelsPage tab="context" />,
      "/settings/codeitlab/context",
    );
    await setPresentations([]);

    expect(tabLink(screen, "context")?.getAttribute("aria-current")).toBe("page");
    expect(pageText(screen)).toContain("Context sizes");
    expect(pageText(screen)).toContain("Claude Sonnet 4.5");
    expect(pageText(screen)).not.toContain("Models and quota");
  });

  it("counts what the catalog advertises, not just what it lists", async () => {
    setup({
      providers: [
        provider({ models: ["gpt-5.4"], modelCount: 5 }),
        provider({
          providerInstanceId: "claude",
          providerKind: "claude",
          name: "Claude",
          models: ["opus-4.5", "sonnet-4.5"],
          available: false,
        }),
      ],
    });
    await using screen = await renderPage(<CodeItLabModelsPage />);
    await setPresentations([]);

    expect(sessionText(screen)).toContain("showing 1 of 7 advertised");
  });

  it("explains the decision with the router's own chip and reason", async () => {
    setup({ providers: [provider({ models: ["gpt-5.4", "gpt-5.2"] })], history: [decision()] });
    await using screen = await renderPage(<CodeItLabModelsPage />);
    await setPresentations([]);

    const text = sessionText(screen);
    expect(text).toContain("coding · heuristic");
    expect(text).toContain(decision().reason);
    expect(text).toContain(HEURISTIC_NOTE);
    expect(text).toContain("would pick now");
    expect(text).toContain("score 0.78");
    expect(text).toContain("smartness 0.90");
    expect(text).toContain("Not a candidate for this task class; the router did not score it.");
    expect(text).toContain("score not reported");
    // No thread is selected on a settings page, so the section points at where
    // the real number lives instead of inventing one.
    expect(text).toContain("Context usage is shown per thread in the composer picker");
    expect(text).not.toContain("tokens");
  });

  it("says there is no decision instead of inventing a verdict", async () => {
    setup({ history: [] });
    await using screen = await renderPage(<CodeItLabModelsPage />);
    await setPresentations([]);

    const text = sessionText(screen);
    expect(text).toContain(NO_DECISION_REASON);
    expect(text).not.toContain(HEURISTIC_NOTE);
    expect(text).not.toContain("would pick now");
  });
});

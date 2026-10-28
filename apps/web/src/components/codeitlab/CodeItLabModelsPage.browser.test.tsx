import type { CodeItLabModelEndpoint, CodeItLabModelsSettings } from "@codeitlab/core/models";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type RoutingCatalog,
  type RoutingHealth,
  type ServerProvider,
} from "@codeitlab/contracts";
import { RegistryContext } from "@effect/atom-react";
import type { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render as renderUi } from "../../../test/render";
import type { EnvironmentUsageStatus } from "../../state/usage";
import { CodeItLabModelsPage } from "./CodeItLabModelsPage";

const CHECKED_AT = "2026-10-25T08:00:00.000Z";
const NOW = Date.parse(CHECKED_AT);

const mock = vi.hoisted(() => ({
  routing: null as unknown,
  credentials: null as unknown,
  probe: vi.fn(),
  models: null as unknown as CodeItLabModelsSettings,
  updates: [] as Array<{ models: CodeItLabModelsSettings }>,
  providerModelPreferences: {} as Record<string, { hiddenModels: string[] }>,
  updateModelPreferences: vi.fn(async (_patch: unknown) => undefined),
  environments: [] as ReadonlyArray<EnvironmentUsageStatus>,
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
    codeitlab: { models: mock.models },
    environmentId: null,
    update: (patch: { models: CodeItLabModelsSettings }) => {
      mock.updates.push(patch);
      mock.models = patch.models;
      return { models: mock.models };
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
    environments: mock.environments,
    selectedEnvironments: mock.environments,
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

import { appAtomRegistry } from "~/rpc/atomRegistry";

function provider(
  overrides: Partial<RoutingCatalog["providers"][number]> = {},
): RoutingCatalog["providers"][number] {
  return {
    providerInstanceId: "codex",
    providerKind: "codex",
    name: "Codex",
    models: ["gpt-5.4", "gpt-5.2"],
    available: true,
    quota: 1,
    speed: 0.8,
    smartness: 0.9,
    ...overrides,
  };
}

function routingView(
  providers: ReadonlyArray<RoutingCatalog["providers"][number]>,
  entries: RoutingHealth["entries"] = [],
) {
  const catalog: RoutingCatalog = { mode: "auto", providers: [...providers], omniRouteModels: [] };
  const health: RoutingHealth = {
    checkedAt: CHECKED_AT,
    intervalMinutes: 15,
    nextCheckAt: "2026-10-25T08:15:00.000Z",
    source: "scheduled",
    entries,
  };
  return {
    data: catalog,
    history: [],
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

function credentialsView(enabled: boolean, source: "server" | "local" = "server") {
  return {
    data: { enabled },
    source,
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

function endpoint(overrides: Partial<CodeItLabModelEndpoint> = {}): CodeItLabModelEndpoint {
  return {
    id: "my-gateway",
    label: "My gateway",
    baseUrl: "https://api.example.com/v1",
    apiKeyEnv: "MY_GATEWAY_KEY",
    models: ["gateway-large"],
    enabled: true,
    maskPrompts: true,
    ...overrides,
  };
}

function modelsSettings(overrides: Partial<CodeItLabModelsSettings> = {}): CodeItLabModelsSettings {
  return { endpoints: [], ...overrides };
}

function environmentStatus(
  overrides: Partial<EnvironmentUsageStatus> = {},
): EnvironmentUsageStatus {
  return {
    environmentId: EnvironmentId.make("test-environment"),
    label: "Test environment",
    isPending: false,
    canReadDiagnostics: true,
    isConnected: true,
    error: null,
    summary: null,
    needsCursorKeychainAccess: false,
    ...overrides,
  };
}

function providerSnapshot(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", label: "Codex Pro" },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

function presentation(providers: ReadonlyArray<ServerProvider>) {
  return {
    entry: { target: { label: "Test environment" } },
    connection: { phase: "connected", error: null, traceId: null },
    serverConfig: { providers },
  };
}

function setup(
  options: {
    readonly providers?: ReadonlyArray<RoutingCatalog["providers"][number]>;
    readonly entries?: RoutingHealth["entries"];
    readonly models?: CodeItLabModelsSettings;
    readonly firewall?: boolean;
    readonly firewallSource?: "server" | "local";
    readonly environments?: ReadonlyArray<EnvironmentUsageStatus>;
    readonly providerModelPreferences?: Record<string, { hiddenModels: string[] }>;
  } = {},
) {
  mock.models = options.models ?? modelsSettings();
  mock.updates.length = 0;
  mock.providerModelPreferences = options.providerModelPreferences ?? {};
  mock.updateModelPreferences.mockReset();
  mock.updateModelPreferences.mockResolvedValue(undefined);
  mock.probe.mockReset();
  mock.probe.mockResolvedValue(null);
  mock.routing = routingView(options.providers ?? [provider()], options.entries ?? []);
  mock.credentials = credentialsView(options.firewall ?? true, options.firewallSource ?? "server");
  mock.environments = options.environments ?? [];
}

const setPresentations = (
  entries: ReadonlyArray<readonly [EnvironmentId, unknown]>,
): Promise<unknown> =>
  act(async () => {
    appAtomRegistry.set(mock.presentations, new Map(entries));
  });

const pageText = (screen: { readonly container: HTMLElement }): string =>
  screen.container.textContent ?? "";

// The page reads the presentations atom, so its registry must be the one the
// test writes to; the default render has no registry of its own.
const renderPage = () =>
  renderUi(
    <RegistryContext.Provider value={appAtomRegistry}>
      <CodeItLabModelsPage />
    </RegistryContext.Provider>,
  );

describe("models page", () => {
  it("lists every advertised model and names how many of them are shown", async () => {
    setup({
      providers: [
        provider({ models: ["gpt-5.4", "gpt-5.2"], modelCount: 47 }),
        provider({
          providerInstanceId: "claude",
          providerKind: "claude",
          name: "Claude",
          models: ["opus-4.5"],
        }),
      ],
    });
    await using screen = await renderPage();
    await setPresentations([]);

    const text = pageText(screen);
    expect(text).toContain("showing 2 of 47 advertised");
    expect(text).toContain("gpt-5.4");
    expect(text).toContain("opus-4.5");
    expect(text).toContain("3 listed models");
    expect(text).toContain("A hidden model still answers when a thread already selects it");
  });

  it("hides a model through the record the picker itself reads", async () => {
    setup();
    await using screen = await renderPage();
    await setPresentations([]);

    await userEvent.click(screen.getByRole("switch", { name: "Hide gpt-5.4 from CodeItLabx" }));
    await vi.waitFor(() => expect(mock.updateModelPreferences).toHaveBeenCalledTimes(1));
    expect(mock.updateModelPreferences).toHaveBeenCalledWith({
      setModelsHidden: [{ provider: "codex", model: "gpt-5.4", hidden: true }],
    });
    expect(screen.container.querySelector('[role="status"]')?.textContent).toContain(
      "A thread that already selects it still answers.",
    );
    // The CodeItLab models slice only holds endpoints now; visibility must not
    // be written there.
    expect(mock.updates).toHaveLength(0);
  });

  it("shows a model the picker hides and unhides it through the same record", async () => {
    setup({ providerModelPreferences: { codex: { hiddenModels: ["gpt-5.4"] } } });
    await using screen = await renderPage();
    await setPresentations([]);

    expect(pageText(screen)).toContain("Hidden");
    await userEvent.click(screen.getByRole("switch", { name: "Show gpt-5.4 from CodeItLabx" }));
    await vi.waitFor(() => expect(mock.updateModelPreferences).toHaveBeenCalledTimes(1));
    expect(mock.updateModelPreferences).toHaveBeenCalledWith({
      setModelsHidden: [{ provider: "codex", model: "gpt-5.4", hidden: false }],
    });
  });

  it("says endpoint models are not in the picker and offers no toggle", async () => {
    setup({ models: modelsSettings({ endpoints: [endpoint()] }) });
    await using screen = await renderPage();
    await setPresentations([]);

    expect(pageText(screen)).toContain("Not in the picker");
    expect(
      screen.container.querySelector('[aria-label="Hide gateway-large from My gateway"]'),
    ).toBeNull();
    expect(
      screen.container.querySelector('[aria-label="Show gateway-large from My gateway"]'),
    ).toBeNull();
    expect(mock.updateModelPreferences).not.toHaveBeenCalled();
  });

  it("shows a measured latency only where the probe measured one", async () => {
    setup({
      entries: [
        {
          providerInstanceId: "codex",
          providerKind: "codex",
          name: "Codex",
          ok: true,
          status: "ok",
          quota: 1,
          models: 2,
          speeds: [
            { model: "gpt-5.4", latencyMs: 840, ok: true, checkedAt: CHECKED_AT },
            {
              model: "gpt-5.2",
              latencyMs: 30_000,
              ok: false,
              checkedAt: CHECKED_AT,
              error: "timed out",
            },
          ],
        },
      ],
    });
    await using screen = await renderPage();
    await setPresentations([]);

    const text = pageText(screen);
    expect(text).toContain("840 ms");
    expect(text).toContain("probe failed");
    expect(text).toContain("1 measured");
  });

  it("shows each reported quota window with its reset time", async () => {
    using _now = vi.spyOn(Date, "now").mockReturnValue(NOW);
    setup({ environments: [environmentStatus()] });
    await using screen = await renderPage();
    await setPresentations([
      [
        EnvironmentId.make("test-environment"),
        presentation([
          providerSnapshot({
            usageLimits: {
              checkedAt: CHECKED_AT,
              windows: [
                {
                  id: "five_hour",
                  kind: "session",
                  label: "Session",
                  usedPercent: 40,
                  resetsAt: "2026-10-25T10:00:00.000Z",
                },
              ],
            },
          }),
        ]),
      ],
    ]);

    await vi.waitFor(() => expect(pageText(screen)).toContain("Session"));
    const text = pageText(screen);
    expect(text).toContain("resets in 2 h");
    expect(text).toContain("40%");
    expect(text).toContain("Plan: Codex Pro");
  });

  it("says an API-key account cannot report windows instead of drawing empty bars", async () => {
    setup({ environments: [environmentStatus()] });
    await using screen = await renderPage();
    await setPresentations([
      [
        EnvironmentId.make("test-environment"),
        presentation([
          providerSnapshot({
            auth: { status: "authenticated", type: "api-key" },
            usageLimits: {
              checkedAt: CHECKED_AT,
              windows: [],
              unavailable: { reason: "unsupported" },
            },
          }),
        ]),
      ],
    ]);

    await vi.waitFor(() => expect(pageText(screen)).toContain("cannot report usage windows"));
    expect(pageText(screen)).toContain("Plan: not reported");
  });

  it("refuses a bad endpoint URL inline and saves the canonical one", async () => {
    setup();
    await using screen = await renderPage();
    await setPresentations([]);

    await userEvent.type(screen.getByLabelText("Endpoint name"), "My gateway");
    await userEvent.type(screen.getByLabelText("Endpoint base URL"), "ftp://api.example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain(
        "Only http and https endpoints are supported.",
      ),
    );
    expect(mock.updates).toHaveLength(0);

    await userEvent.clear(screen.getByLabelText("Endpoint base URL"));
    await userEvent.type(screen.getByLabelText("Endpoint base URL"), "https://api.example.com/v1/");
    await userEvent.click(screen.getByRole("button", { name: "Add endpoint" }));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.models.endpoints[0]).toMatchObject({
      id: "my-gateway",
      label: "My gateway",
      baseUrl: "https://api.example.com/v1",
      enabled: true,
      maskPrompts: true,
    });
  });

  it("fetches models from an endpoint and offers to save what it listed", async () => {
    setup({ models: modelsSettings({ endpoints: [endpoint({ models: [] })] }) });
    mock.probe.mockResolvedValue({
      checkedAt: CHECKED_AT,
      baseUrl: "https://api.example.com/v1",
      reachable: true,
      status: 200,
      models: ["gateway-large", "gateway-small"],
    });
    await using screen = await renderPage();
    await setPresentations([]);

    await userEvent.click(screen.getByRole("button", { name: "Fetch models" }));
    await vi.waitFor(() =>
      expect(pageText(screen)).toContain("Reached the endpoint: 2 models listed."),
    );
    expect(mock.probe).toHaveBeenCalledWith({
      baseUrl: "https://api.example.com/v1",
      apiKeyEnv: "MY_GATEWAY_KEY",
    });

    await userEvent.click(screen.getByRole("button", { name: "Save 2 model ids" }));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.models.endpoints[0]?.models).toEqual([
      "gateway-large",
      "gateway-small",
    ]);
  });

  it("does not claim masking while the firewall is off", async () => {
    setup({ firewall: false, models: modelsSettings({ endpoints: [endpoint()] }) });
    await using screen = await renderPage();
    await setPresentations([]);

    const text = pageText(screen);
    expect(text).toContain("Masking is off.");
    expect(text).not.toContain("Prompts are masked before they leave this machine.");
    expect(text).toContain("Masking off");
  });

  it("says masking status is unknown when the firewall has not reported", async () => {
    setup({
      firewall: true,
      firewallSource: "local",
      models: modelsSettings({ endpoints: [endpoint()] }),
    });
    await using screen = await renderPage();
    await setPresentations([]);

    expect(pageText(screen)).toContain("Masking status is unknown.");
  });

  it("claims masking only when the firewall is on and the endpoint masks", async () => {
    setup({ firewall: true, models: modelsSettings({ endpoints: [endpoint()] }) });
    await using screen = await renderPage();
    await setPresentations([]);

    expect(pageText(screen)).toContain("Prompts are masked before they leave this machine.");
    expect(pageText(screen)).toContain("Masked");
  });

  it("turns masking off for one endpoint and warns that its prompts leave as written", async () => {
    setup({ firewall: true, models: modelsSettings({ endpoints: [endpoint()] }) });
    await using screen = await renderPage();
    await setPresentations([]);

    await userEvent.click(screen.getByRole("switch", { name: "Mask prompts for My gateway" }));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.models.endpoints[0]?.maskPrompts).toBe(false);
    await vi.waitFor(() => expect(pageText(screen)).toContain("Some prompts leave unmasked."));
  });
});

import type {
  CodeItLabRoutingSettings,
  RoutingCatalog,
  RoutingDecision,
  RoutingHealth,
} from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabRoutingPage } from "./CodeItLabRoutingPage";

const CHECKED_AT = "2026-10-24T04:00:00.000Z";

const mock = vi.hoisted(() => ({
  routing: null as unknown,
  settings: null as unknown,
  updates: [] as Array<{ routing: CodeItLabRoutingSettings }>,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabRouting: (() => mock.routing) as never,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: mock.settings,
    environmentId: null,
    update: (patch: { routing: CodeItLabRoutingSettings }) => {
      mock.updates.push(patch);
      mock.settings = {
        ...(mock.settings as { routing: CodeItLabRoutingSettings }),
        routing: patch.routing,
      };
      return mock.settings;
    },
  })) as never,
}));

const HEALTH: RoutingHealth = {
  checkedAt: CHECKED_AT,
  intervalMinutes: 30,
  nextCheckAt: CHECKED_AT,
  source: "manual",
  entries: [],
};

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

const hermes = (): RoutingCatalog["providers"][number] =>
  provider({
    providerInstanceId: "hermes",
    providerKind: "acpRegistry",
    name: "Hermes",
    models: ["deepseek-v4"],
  });

function decision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    id: "route-explain",
    decidedAt: CHECKED_AT,
    taskClass: "coding",
    providerInstanceId: "codex",
    providerKind: "codex",
    model: "gpt-5.4",
    reason: "coding task: gpt-5.4 has the best weighted score.",
    candidates: [
      {
        providerInstanceId: "hermes",
        providerKind: "acpRegistry",
        model: "deepseek-v4",
        quota: 0.35,
        smartness: 0.7,
        speed: 0.95,
        score: 0.66,
        available: false,
      },
      {
        providerInstanceId: "codex",
        providerKind: "codex",
        model: "gpt-5.4",
        quota: 0.62,
        smartness: 0.9,
        speed: 0.8,
        score: 0.81,
        available: true,
      },
    ],
    ...overrides,
  };
}

function routingSettings(overrides: Partial<CodeItLabRoutingSettings> = {}): {
  routing: CodeItLabRoutingSettings;
} {
  return {
    routing: {
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
    },
  };
}

function setup(
  input: {
    readonly history?: ReadonlyArray<RoutingDecision>;
    readonly providers?: ReadonlyArray<RoutingCatalog["providers"][number]>;
    readonly routing?: Partial<CodeItLabRoutingSettings>;
  } = {},
) {
  mock.updates.length = 0;
  const catalog: RoutingCatalog = {
    mode: "auto",
    providers: [...(input.providers ?? [provider()])],
    omniRouteModels: [],
  };
  mock.routing = {
    data: catalog,
    source: "server",
    error: null,
    isPending: false,
    refresh: () => {},
    history: input.history ?? [],
    health: HEALTH,
    healthSource: "server",
    healthIsPending: false,
    refreshHealth: () => {},
    checkHealth: async () => null,
    decide: async () => null,
  };
  mock.settings = routingSettings(input.routing);
}

describe("routing page explanation", () => {
  it("explains the newest decision with the candidate numbers and the picked badge", async () => {
    setup({ history: [decision()] });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const card = screen.container.querySelector<HTMLElement>('[data-codeitlab-why-model="true"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Why this model");
    expect(card?.textContent).toContain("coding");
    expect(card?.textContent).toContain("gpt-5.4");
    expect(card?.textContent).toContain("CodeItLabx");

    const rows = [...(card?.querySelectorAll<HTMLElement>("[data-route-candidate]") ?? [])];
    expect(rows.map((row) => row.getAttribute("data-route-candidate"))).toEqual([
      "gpt-5.4",
      "deepseek-v4",
    ]);
    expect(rows[0]?.getAttribute("data-candidate-picked")).toBe("true");
    expect(rows[1]?.getAttribute("data-candidate-picked")).toBe("false");
    expect(rows[0]?.textContent).toContain("62%");
    expect(rows[0]?.textContent).toContain("0.90");
    expect(rows[0]?.textContent).toContain("0.80");
    expect(rows[0]?.textContent).toContain("0.81");
    expect(rows[1]?.getAttribute("data-candidate-available")).toBe("false");
    expect(rows[1]?.textContent).toContain("unavailable");

    const picked = card?.querySelector<HTMLElement>('[data-route-picked="true"]');
    expect(picked?.textContent).toContain("picked");
  });

  it("marks overrides and delegated decisions with an accessible description", async () => {
    setup({ history: [decision({ override: true, delegated: true })] });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const override = screen.container.querySelector<HTMLElement>('[data-route-override="true"]');
    expect(override?.textContent).toContain("override");
    const delegated = screen.container.querySelector<HTMLElement>('[data-route-delegated="true"]');
    expect(delegated?.textContent).toContain("delegated");

    const describedBy = delegated?.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const note = document.getElementById(describedBy ?? "");
    expect(note?.textContent).toContain("provider's own router chose it");
  });

  it("says a decision recorded no candidate scores instead of drawing an empty table", async () => {
    setup({ history: [decision({ candidates: [] })] });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const card = screen.container.querySelector<HTMLElement>('[data-codeitlab-why-model="true"]');
    expect(card?.querySelector("[data-route-candidates]")).toBeNull();
    expect(card?.textContent).toContain("No candidate scores were recorded for this decision");
  });

  it("saves a per-task override with the pinned provider and model", async () => {
    setup({ providers: [provider(), hermes()] });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    await userEvent.click(screen.getByLabelText("Override provider for coding"));
    await userEvent.click(page.getByRole("option", { name: "CodeItLabx" }));

    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.routing.taskOverrides).toEqual([
      { taskClass: "coding", providerInstanceId: "codex", model: "gpt-5.4" },
    ]);

    await userEvent.click(screen.getByLabelText("Override model for coding"));
    await userEvent.click(page.getByRole("option", { name: "gpt-5.2" }));

    await vi.waitFor(() => expect(mock.updates).toHaveLength(2));
    expect(mock.updates[1]?.routing.taskOverrides).toEqual([
      { taskClass: "coding", providerInstanceId: "codex", model: "gpt-5.2" },
    ]);

    await userEvent.click(screen.getByLabelText("Router decides for coding turns"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(3));
    expect(mock.updates[2]?.routing.taskOverrides).toEqual([]);
  });

  it("persists a delegated provider kind when its checkbox is toggled", async () => {
    setup({ providers: [provider(), hermes()] });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const checkbox = screen.container.querySelector<HTMLElement>(
      '[data-delegated-checkbox="acpRegistry"]',
    );
    expect(checkbox?.getAttribute("aria-checked")).toBe("false");

    await userEvent.click(checkbox!);

    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.routing.delegatedProviderKinds).toEqual(["acpRegistry"]);
    expect(checkbox?.getAttribute("aria-checked")).toBe("true");
  });

  it("shows honest empty states when the catalog has no providers", async () => {
    setup({ providers: [] });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const text = screen.container.textContent ?? "";
    expect(text).toContain("No providers in the catalog yet, so there is nothing to pin.");
    expect(text).toContain(
      "No providers in the catalog yet. Once an agent is connected, its provider kind appears here.",
    );
  });
});

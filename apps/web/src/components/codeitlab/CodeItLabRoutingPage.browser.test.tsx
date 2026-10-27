import type {
  CodeItLabRoutingSettings,
  RoutingCatalog,
  RoutingDecision,
  RoutingHealth,
  RoutingHealthEntry,
} from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render as renderUi } from "../../../test/render";
import { CodeItLabRoutingPage } from "./CodeItLabRoutingPage";

const CHECKED_AT = "2026-10-23T04:00:00.000Z";

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
      return mock.settings;
    },
  })) as never,
}));

function speed(
  model: string,
  latencyMs: number,
  ok = true,
  error?: string,
): NonNullable<RoutingHealthEntry["speeds"]>[number] {
  return {
    model,
    latencyMs,
    ok,
    checkedAt: CHECKED_AT,
    ...(error === undefined ? {} : { error }),
  };
}

function entry(
  input: Partial<RoutingHealthEntry> &
    Pick<RoutingHealthEntry, "providerInstanceId" | "name" | "speeds">,
): RoutingHealthEntry {
  return {
    providerKind: "codex",
    ok: true,
    status: "ok",
    quota: 0.7,
    models: 9,
    ...input,
  };
}

const checkingHealth: RoutingHealth = {
  checkedAt: CHECKED_AT,
  intervalMinutes: 30,
  nextCheckAt: "2026-10-23T04:30:00.000Z",
  source: "manual",
  speedProbe: { status: "checking", startedAt: CHECKED_AT, checked: 2, total: 6 },
  entries: [
    entry({
      providerInstanceId: "hermes",
      providerKind: "acpRegistry",
      name: "Hermes",
      quota: 0.72,
      models: 12,
      speedProbe: {
        status: "checking",
        startedAt: CHECKED_AT,
        checked: 2,
        total: 3,
        retrying: ["qwen3-coder"],
      },
      speeds: [
        speed("deepseek-v4", 840),
        speed("qwen3-coder", 2_400, false, "Timed out after 20 s waiting for the first token"),
      ],
    }),
    entry({
      providerInstanceId: "codex",
      name: "Codex",
      quota: 0.84,
      models: 9,
      speedProbe: { status: "checking", startedAt: CHECKED_AT, checked: 0, total: 3 },
      speeds: [],
    }),
  ],
};

const finishedHealth: RoutingHealth = {
  checkedAt: CHECKED_AT,
  intervalMinutes: 30,
  nextCheckAt: "2026-10-23T04:30:00.000Z",
  source: "manual",
  speedProbe: {
    status: "partial",
    startedAt: CHECKED_AT,
    finishedAt: CHECKED_AT,
    checked: 3,
    total: 3,
  },
  entries: [
    entry({
      providerInstanceId: "hermes",
      providerKind: "acpRegistry",
      name: "Hermes",
      quota: 0.72,
      models: 12,
      speedProbe: {
        status: "partial",
        startedAt: CHECKED_AT,
        finishedAt: CHECKED_AT,
        checked: 2,
        total: 2,
        retrying: ["qwen3-coder"],
      },
      speeds: [speed("deepseek-v4", 840), speed("qwen3-coder", 2_400, false, "rate limited")],
    }),
    entry({
      providerInstanceId: "codex",
      name: "Codex",
      quota: 0.84,
      models: 9,
      speedProbe: {
        status: "done",
        startedAt: CHECKED_AT,
        finishedAt: CHECKED_AT,
        checked: 1,
        total: 1,
      },
      speeds: [speed("gpt-5", 1_200)],
    }),
  ],
};

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

const deepCheckingHealth: RoutingHealth = {
  checkedAt: CHECKED_AT,
  intervalMinutes: 30,
  nextCheckAt: "2026-10-23T04:30:00.000Z",
  source: "manual",
  speedProbe: {
    status: "checking",
    mode: "deep",
    startedAt: CHECKED_AT,
    checked: 420,
    total: 2_210,
    okCount: 300,
    failedCount: 120,
  },
  entries: [
    entry({
      providerInstanceId: "hermes",
      providerKind: "acpRegistry",
      name: "Hermes",
      quota: 0.72,
      models: 2_210,
      speedProbe: {
        status: "checking",
        mode: "deep",
        startedAt: CHECKED_AT,
        checked: 420,
        total: 2_210,
        modelCount: 2_210,
        okCount: 300,
        failedCount: 120,
      },
      speeds: [],
    }),
  ],
};

const deepFinishedHealth: RoutingHealth = {
  checkedAt: CHECKED_AT,
  intervalMinutes: 30,
  nextCheckAt: "2026-10-23T04:30:00.000Z",
  source: "manual",
  speedProbe: {
    status: "done",
    mode: "deep",
    startedAt: CHECKED_AT,
    finishedAt: CHECKED_AT,
    checked: 2_210,
    total: 2_210,
    okCount: 1_900,
    failedCount: 310,
  },
  entries: [
    entry({
      providerInstanceId: "hermes",
      providerKind: "acpRegistry",
      name: "Hermes",
      quota: 0.72,
      models: 2_210,
      speedProbe: {
        status: "done",
        mode: "deep",
        startedAt: CHECKED_AT,
        finishedAt: CHECKED_AT,
        checked: 2_210,
        total: 2_210,
        modelCount: 2_210,
        okCount: 1_900,
        failedCount: 310,
      },
      speeds: [speed("deepseek-v4", 640), speed("broken-model", 12_000, false, "HTTP 404")],
    }),
  ],
};

function catalog(): RoutingCatalog {
  return { mode: "auto", providers: [], omniRouteModels: [] };
}

function setup(input: {
  readonly health: RoutingHealth;
  readonly routing?: Partial<CodeItLabRoutingSettings>;
  readonly history?: ReadonlyArray<RoutingDecision>;
}) {
  mock.updates.length = 0;
  mock.routing = {
    data: catalog(),
    source: "local",
    error: null,
    isPending: false,
    refresh: () => {},
    history: input.history ?? [],
    health: input.health,
    healthSource: "local",
    healthIsPending: false,
    refreshHealth: () => {},
    checkHealth: async () => null,
    decide: async () => null,
  };
  mock.settings = routingSettings(input.routing);
}

function query(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

describe("CodeItLabRoutingPage speed probe", () => {
  it("shows the checking banner with progress while models are probed", async () => {
    setup({ health: checkingHealth });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const banner = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-speed-probe="checking"]',
    );
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Checking all harness and models…");
    expect(banner?.getAttribute("data-speed-probe-checked")).toBe("2");
    expect(banner?.getAttribute("data-speed-probe-total")).toBe("6");
    expect(banner?.getAttribute("data-speed-probe-providers")).toBe("2");
    expect(banner?.textContent).toContain("2 providers");
    expect(banner?.textContent).toContain("hi");
    expect(banner?.textContent).toContain("Failed models are retried automatically.");
    expect(query('[data-codeitlab-speed-probe="done"]')).toBeNull();
  });

  it("replaces the banner with a measured-speed summary when finished", async () => {
    setup({ health: finishedHealth });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const summary = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-speed-probe="done"]',
    );
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain(
      "Measured 3 models in 2 providers · fastest: CodeItLab Hermes · 840 ms",
    );
    expect(summary?.getAttribute("data-speed-probe-models")).toBe("3");
    expect(summary?.getAttribute("data-speed-probe-providers")).toBe("2");
    expect(query('[data-codeitlab-speed-probe="checking"]')).toBeNull();
  });

  it("lists every measured model inside its provider row", async () => {
    setup({ health: finishedHealth });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const hermes = screen.container.querySelector<HTMLElement>('[data-health-provider="hermes"]');
    expect(hermes).not.toBeNull();
    expect(hermes?.querySelector('[data-health-speeds="true"]')).not.toBeNull();

    const fast = hermes?.querySelector<HTMLElement>('[data-speed-model="deepseek-v4"]');
    expect(fast).not.toBeNull();
    expect(fast?.getAttribute("data-speed-latency-ms")).toBe("840");
    expect(fast?.getAttribute("data-speed-ok")).toBe("true");
    expect(fast?.textContent).toContain("840 ms");
    expect(fast?.textContent).toContain("fastest");

    const failed = hermes?.querySelector<HTMLElement>('[data-speed-model="qwen3-coder"]');
    expect(failed).not.toBeNull();
    expect(failed?.getAttribute("data-speed-ok")).toBe("false");
    expect(failed?.getAttribute("data-speed-latency-ms")).toBe("2400");
    expect(failed?.textContent).toContain("2.4 s");
    expect(failed?.textContent).toContain("failed");
    expect(failed?.textContent).toContain("rate limited");
    expect(failed?.textContent).toContain("retrying");

    const fastestModels = [...(hermes?.querySelectorAll("[data-speed-model]") ?? [])]
      .filter((model) => model.textContent?.includes("fastest"))
      .map((model) => model.getAttribute("data-speed-model"));
    expect(fastestModels).toEqual(["deepseek-v4"]);

    const codex = screen.container.querySelector<HTMLElement>('[data-health-provider="codex"]');
    const gpt = codex?.querySelector<HTMLElement>('[data-speed-model="gpt-5"]');
    expect(gpt?.getAttribute("data-speed-latency-ms")).toBe("1200");
    expect(gpt?.textContent).toContain("1.2 s");
    // The badge is per provider: the only probed model is that provider's fastest.
    expect(gpt?.textContent).toContain("fastest");
  });

  it("toggles the probe setting and disables the model count when off", async () => {
    setup({ health: finishedHealth });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const toggle = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="speedProbe"]',
    );
    const count = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="speedProbeModelsPerProvider"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(count?.hasAttribute("disabled")).toBe(false);

    await act(() => toggle?.click());

    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0]?.routing.speedProbe).toBe(false);
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(count?.hasAttribute("disabled")).toBe(true);
  });

  it("renders no probe banner when the probe is off", async () => {
    setup({
      health: {
        ...finishedHealth,
        speedProbe: { status: "off", startedAt: CHECKED_AT, checked: 0, total: 0 },
        entries: finishedHealth.entries.map((entry) => ({
          providerInstanceId: entry.providerInstanceId,
          providerKind: entry.providerKind,
          name: entry.name,
          ok: entry.ok,
          status: entry.status,
          quota: entry.quota,
          models: entry.models,
        })),
      },
      routing: { speedProbe: false },
    });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    expect(query("[data-codeitlab-speed-probe]")).toBeNull();
    const toggle = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="speedProbe"]',
    );
    const count = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="speedProbeModelsPerProvider"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(count?.hasAttribute("disabled")).toBe(true);
  });

  it("shows deep-scan progress with measured/failed counts while it runs", async () => {
    setup({ health: deepCheckingHealth });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const banner = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-speed-probe="deep"]',
    );
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("Scanning every advertised model…");
    expect(banner?.getAttribute("data-speed-probe-checked")).toBe("420");
    expect(banner?.getAttribute("data-speed-probe-total")).toBe("2210");
    expect(banner?.getAttribute("data-speed-probe-ok")).toBe("300");
    expect(banner?.getAttribute("data-speed-probe-failed")).toBe("120");
    expect(banner?.getAttribute("data-speed-probe-providers")).toBe("1");
    expect(banner?.textContent).toContain("300 available");
    expect(banner?.textContent).toContain("120 failed");
    expect(query('[data-codeitlab-speed-probe="checking"]')).toBeNull();
  });

  it("summarises the finished deep scan and marks provider scan rows", async () => {
    setup({ health: deepFinishedHealth });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const summary = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-speed-probe="deep-done"]',
    );
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain("Scanned 2210 models in 1 provider");
    expect(summary?.textContent).toContain("1900 available");
    expect(summary?.textContent).toContain("310 failed");
    expect(summary?.textContent).toContain("fastest: CodeItLab Hermes · 640 ms");
    expect(summary?.getAttribute("data-speed-probe-total")).toBe("2210");
    expect(summary?.getAttribute("data-speed-probe-ok")).toBe("1900");

    const hermes = screen.container.querySelector<HTMLElement>('[data-health-provider="hermes"]');
    expect(hermes?.getAttribute("data-provider-scan-mode")).toBe("deep");
    expect(hermes?.querySelector('[data-provider-scan-summary="true"]')?.textContent).toContain(
      "deep scan · 1900/2210 available",
    );
    expect(query('[data-codeitlab-speed-probe="done"]')).toBeNull();
  });

  it("toggles the deep scan and disables its tuning selects when off", async () => {
    setup({ health: deepFinishedHealth });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const toggle = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="deepScan"]',
    );
    const concurrency = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="deepScanConcurrency"]',
    );
    const timeout = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="deepScanTimeoutSeconds"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(concurrency?.hasAttribute("disabled")).toBe(false);
    expect(timeout?.hasAttribute("disabled")).toBe(false);

    await act(() => toggle?.click());

    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0]?.routing.deepScan).toBe(false);
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(concurrency?.hasAttribute("disabled")).toBe(true);
    expect(timeout?.hasAttribute("disabled")).toBe(true);
  });

  it("renders the backup-provider settings and disables them while fallback is off", async () => {
    setup({ health: finishedHealth, routing: { fallbackOnProviderFailure: false } });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const toggle = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="fallbackOnProviderFailure"]',
    );
    const provider = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="fallbackInstanceId"]',
    );
    const model = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="fallbackModel"]',
    );
    const cooldown = screen.container.querySelector<HTMLElement>(
      '[data-codeitlab-setting="providerFailureCooldownMinutes"]',
    );

    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(provider).not.toBeNull();
    expect(model).not.toBeNull();
    expect(cooldown).not.toBeNull();
    expect(provider?.hasAttribute("disabled")).toBe(true);
    expect(cooldown?.hasAttribute("disabled")).toBe(true);

    await act(() => toggle?.click());

    expect(mock.updates).toHaveLength(1);
    expect(mock.updates[0]?.routing.fallbackOnProviderFailure).toBe(true);
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(provider?.hasAttribute("disabled")).toBe(false);
    expect(cooldown?.hasAttribute("disabled")).toBe(false);
  });

  it("keeps focus and announces the new position after a reorder", async () => {
    setup({
      health: finishedHealth,
      routing: { providerOrder: ["hermes", "claudeAgent", "codex"] },
    });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const up = screen.container.querySelector<HTMLButtonElement>(
      '[data-routing-move="claudeAgent:up"]',
    );
    up?.focus();
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() =>
      expect(mock.updates.at(-1)?.routing.providerOrder).toEqual([
        "claudeAgent",
        "hermes",
        "codex",
      ]),
    );
    // claudeAgent is now first, so its Move up button is disabled and focus has to
    // land on the opposite arrow of the same row instead of the body.
    const status = screen.container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Moved claudeAgent up to position 1.");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.container.querySelector('[data-routing-move="claudeAgent:down"]'),
      ),
    );
  });

  it("marks a decision that fell back to the backup provider", async () => {
    setup({
      health: finishedHealth,
      history: [
        {
          id: "route_fallback",
          decidedAt: CHECKED_AT,
          taskClass: "coding",
          providerInstanceId: "hermes",
          providerKind: "acpRegistry",
          model: "nvidia:gpt-5",
          reason: "fell back to hermes because claudeAgent failed",
          candidates: [],
          enforced: true,
        },
      ],
    });
    await using screen = await renderUi(<CodeItLabRoutingPage />);

    const badge = screen.container.querySelector<HTMLElement>('[data-route-fallback="true"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("fallback");
  });
});

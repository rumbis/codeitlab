import type { RoutingCatalog, RoutingHealth } from "@codeitlab/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { CodeItLabModelEndpoint } from "@codeitlab/core/models";

import {
  buildModelsInventory,
  buildModelsQuota,
  formatQuotaReset,
  HIDDEN_MODEL_REASON,
  maskingLabel,
  maskingVariant,
  summarizeMasking,
  type ModelsQuotaAccountInput,
} from "./modelsInventory";

const catalog = (providers: RoutingCatalog["providers"]): RoutingCatalog => ({
  mode: "auto",
  providers,
  omniRouteModels: [],
});

const provider = (
  overrides: Partial<RoutingCatalog["providers"][number]> = {},
): RoutingCatalog["providers"][number] => ({
  providerInstanceId: "codex",
  providerKind: "codex",
  name: "Codex",
  models: ["gpt-5.4", "gpt-5.2"],
  available: true,
  quota: 1,
  speed: 0.8,
  smartness: 0.9,
  ...overrides,
});

const health = (entries: RoutingHealth["entries"]): RoutingHealth => ({
  checkedAt: "2026-10-25T08:00:00.000Z",
  intervalMinutes: 15,
  nextCheckAt: "2026-10-25T08:15:00.000Z",
  source: "scheduled",
  entries,
});

const healthEntry = (
  overrides: Partial<RoutingHealth["entries"][number]> = {},
): RoutingHealth["entries"][number] => ({
  providerInstanceId: "codex",
  providerKind: "codex",
  name: "Codex",
  ok: true,
  status: "ok",
  quota: 1,
  models: 2,
  ...overrides,
});

const endpoint = (overrides: Partial<CodeItLabModelEndpoint> = {}): CodeItLabModelEndpoint => ({
  id: "my-gateway",
  label: "My gateway",
  baseUrl: "https://api.example.com/v1",
  apiKeyEnv: "MY_GATEWAY_KEY",
  models: ["gateway-large"],
  enabled: true,
  maskPrompts: true,
  ...overrides,
});

const inventory = (input: Partial<Parameters<typeof buildModelsInventory>[0]> = {}) =>
  buildModelsInventory({
    catalog: catalog([provider()]),
    health: health([healthEntry()]),
    endpoints: [],
    hiddenModelsByInstance: {},
    firewallEnabled: true,
    ...input,
  });

const account = (overrides: Partial<ModelsQuotaAccountInput> = {}): ModelsQuotaAccountInput => ({
  id: "env:codex",
  label: "This machine · Codex",
  plan: "Codex Pro",
  windows: [
    {
      id: "five_hour",
      kind: "session",
      label: "Session",
      usedPercent: 40,
      resetsAt: "2026-10-25T10:00:00.000Z",
    },
  ],
  unavailable: null,
  connected: true,
  error: null,
  ...overrides,
});

const NOW = Date.parse("2026-10-25T08:00:00.000Z");

describe("models inventory", () => {
  it("lists every advertised model and names both counts when the list is shorter", () => {
    const result = inventory({
      catalog: catalog([
        provider({ models: ["gpt-5.4", "gpt-5.2"], modelCount: 47 }),
        provider({
          providerInstanceId: "claude",
          providerKind: "claude",
          name: "Claude",
          models: ["opus"],
        }),
      ]),
    });

    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.countLabel).toBe("showing 2 of 47 advertised");
    expect(result.sources[0]?.truncated).toBe(true);
    expect(result.sources[1]?.countLabel).toBe("1 model");
    expect(result.truncatedCount).toBe(1);
    expect(result.totalModels).toBe(3);
  });

  it("keeps a model the picker hides in the list with the reason it is hidden", () => {
    const result = inventory({ hiddenModelsByInstance: { codex: ["gpt-5.2"] } });
    const rows = result.sources[0]?.rows ?? [];
    const hidden = rows.find((row) => row.model === "gpt-5.2");

    expect(hidden?.hidden).toBe(true);
    expect(hidden?.pickable).toBe(true);
    expect(hidden?.hiddenReason).toBe(HIDDEN_MODEL_REASON);
    expect(hidden?.key).toBe("codex::gpt-5.2");
    expect(result.hiddenCount).toBe(1);
    expect(rows).toHaveLength(2);
  });

  it("marks endpoint models as not pickable and never counts them as hidden", () => {
    const result = inventory({
      hiddenModelsByInstance: { codex: ["gpt-5.2"], "my-gateway": ["gateway-large"] },
      endpoints: [endpoint()],
    });
    const source = result.sources[1];
    if (source?.kind !== "endpoint") throw new Error("expected an endpoint source");
    const [row] = source.rows;

    expect(row?.pickable).toBe(false);
    expect(row?.hidden).toBe(false);
    expect(row?.hiddenReason).toBeNull();
    expect(source.hiddenCount).toBe(0);
    // Only the provider row the picker can hide counts.
    expect(result.hiddenCount).toBe(1);
  });

  it("reports a measured latency only for models the probe answered", () => {
    const result = inventory({
      health: health([
        healthEntry({
          speeds: [
            { model: "gpt-5.4", latencyMs: 840, ok: true, checkedAt: "2026-10-25T08:00:00.000Z" },
            {
              model: "gpt-5.2",
              latencyMs: 30_000,
              ok: false,
              checkedAt: "2026-10-25T08:00:00.000Z",
              error: "timed out",
            },
          ],
        }),
      ]),
    });
    const rows = result.sources[0]?.rows ?? [];

    expect(rows[0]?.latencyMs).toBe(840);
    expect(rows[0]?.latencyLabel).toBe("840 ms");
    expect(rows[0]?.probeFailed).toBe(false);
    expect(rows[1]?.latencyMs).toBeNull();
    expect(rows[1]?.latencyLabel).toBe("probe failed");
    expect(rows[1]?.probeFailed).toBe(true);
    expect(result.measuredCount).toBe(1);
  });

  it("says a model was not measured when the probe never covered it", () => {
    const result = inventory({ health: health([]) });
    const rows = result.sources[0]?.rows ?? [];

    expect(rows.every((row) => row.latencyLabel === "not measured")).toBe(true);
    expect(result.measuredCount).toBe(0);
  });

  it("folds a custom endpoint in with its masking badge and an honest empty state", () => {
    const result = inventory({ endpoints: [endpoint()] });
    const source = result.sources[1];

    expect(source?.kind).toBe("endpoint");
    if (source?.kind !== "endpoint") throw new Error("expected an endpoint source");
    expect(source.masking).toBe("masked");
    expect(source.apiKeyEnv).toBe("MY_GATEWAY_KEY");
    expect(source.countLabel).toBe("1 model");
    expect(source.emptyReason).toBeNull();

    const empty = inventory({ endpoints: [endpoint({ models: [] })] }).sources[1];
    if (empty?.kind !== "endpoint") throw new Error("expected an endpoint source");
    expect(empty.countLabel).toBe("no model ids yet");
    expect(empty.emptyReason).toContain("Fetch models");
  });

  it("does not claim masking for an endpoint once the firewall is off", () => {
    const source = inventory({
      endpoints: [endpoint({ maskPrompts: true })],
      firewallEnabled: false,
    }).sources[1];
    if (source?.kind !== "endpoint") throw new Error("expected an endpoint source");

    expect(source.masking).toBe("off");
  });

  it("counts endpoint models in the totals", () => {
    const result = inventory({ endpoints: [endpoint({ models: ["a", "b"] })] });
    expect(result.totalModels).toBe(4);
  });
});

describe("models quota", () => {
  it("turns reported windows into bars with a reset label", () => {
    const [row] = buildModelsQuota({ accounts: [account()], nowMs: NOW });

    expect(row?.windows).toHaveLength(1);
    expect(row?.windows[0]?.usedPercent).toBe(40);
    expect(row?.windows[0]?.resetLabel).toBe("resets in 2 h");
    expect(row?.notReportedReason).toBeNull();
    expect(row?.planLabel).toBe("Codex Pro");
    expect(row?.peakUsedPercent).toBe(40);
  });

  it("explains an API-key account instead of drawing empty bars", () => {
    const [row] = buildModelsQuota({
      accounts: [
        account({
          windows: [],
          plan: null,
          unavailable: { reason: "unsupported" },
        }),
      ],
      nowMs: NOW,
    });

    expect(row?.windows).toEqual([]);
    expect(row?.notReportedReason).toBe(
      "This account signs in with an API key, so the provider cannot report usage windows.",
    );
    expect(row?.planLabel).toBe("not reported");
    expect(row?.peakUsedPercent).toBeNull();
  });

  it("distinguishes a failed probe from a provider that reports nothing", () => {
    const [failed, silent, offline] = buildModelsQuota({
      accounts: [
        account({ windows: [], unavailable: { reason: "probeFailed", message: "timed out" } }),
        account({ windows: [] }),
        account({ windows: [], connected: false }),
      ],
      nowMs: NOW,
    });

    expect(failed?.notReportedReason).toBe("The last quota probe failed: timed out.");
    expect(silent?.notReportedReason).toBe("The provider reported no usage windows.");
    expect(offline?.notReportedReason).toBe(
      "The environment is not connected, so its quota is not reported.",
    );
  });

  it("surfaces an environment that could not report usage", () => {
    const [row] = buildModelsQuota({
      accounts: [account({ windows: [], error: "usage read failed" })],
      nowMs: NOW,
    });
    expect(row?.notReportedReason).toContain("usage read failed");
  });

  it("says when a window has no reset time", () => {
    expect(formatQuotaReset(null, NOW)).toBe("reset time not reported");
    expect(formatQuotaReset("not a date", NOW)).toBe("reset time not reported");
    expect(formatQuotaReset("2026-10-25T07:00:00.000Z", NOW)).toBe("resets now");
    expect(formatQuotaReset("2026-10-26T08:00:00.000Z", NOW)).toBe("resets in 24 h");
    expect(formatQuotaReset("2026-10-30T08:00:00.000Z", NOW)).toBe("resets in 5 d");
  });
});

describe("masking status", () => {
  it("never claims masking when the firewall has not reported", () => {
    const status = summarizeMasking({
      firewallReported: false,
      firewallEnabled: false,
      endpoints: [endpoint()],
    });
    expect(status.badge).toBe("off");
    expect(status.headline).toBe("Masking status is unknown.");
    expect(status.detail).toContain("does not claim masking");
  });

  it("says masking is off when the firewall is disabled", () => {
    const status = summarizeMasking({
      firewallReported: true,
      firewallEnabled: false,
      endpoints: [endpoint()],
    });
    expect(status.badge).toBe("off");
    expect(status.headline).toBe("Masking is off.");
  });

  it("warns when one endpoint asks for raw prompts", () => {
    const status = summarizeMasking({
      firewallReported: true,
      firewallEnabled: true,
      endpoints: [endpoint(), endpoint({ id: "other", maskPrompts: false })],
    });
    expect(status.badge).toBe("raw");
    expect(status.headline).toBe("Some prompts leave unmasked.");
  });

  it("claims masking only when the firewall is on and every endpoint masks", () => {
    const status = summarizeMasking({
      firewallReported: true,
      firewallEnabled: true,
      endpoints: [endpoint()],
    });
    expect(status.badge).toBe("masked");
    expect(status.headline).toBe("Prompts are masked before they leave this machine.");
    expect(maskingLabel("masked")).toBe("Masked");
    expect(maskingVariant("raw")).toBe("warning");
    expect(maskingVariant("off")).toBe("secondary");
  });
});

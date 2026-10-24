import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import type { RoutingCatalog } from "@codeitlab/core/routing";
import { RoutingService } from "@codeitlab/core/services";
import type { ServerSettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { registerActiveRoutingService, resetActiveRoutingService } from "./activeRoutingService.ts";
import { resolveEnforcedModelSelection } from "./enforcedRoute.ts";
import {
  coolingDownProviderIds,
  isProviderCoolingDown,
  providerFailureFor,
  recordProviderFailure,
  resetProviderFailures,
} from "./providerFailures.ts";

const NOW = Date.parse("2026-10-23T02:00:00.000Z");

const catalog: RoutingCatalog = {
  mode: "auto",
  omniRouteModels: [],
  providers: [
    {
      providerInstanceId: "claude",
      providerKind: "claudeAgent",
      name: "Claude",
      models: ["sonnet-5", "opus-5"],
      defaultModel: "sonnet-5",
      available: true,
      quota: 1,
      speed: 0.6,
      smartness: 0.9,
    },
    {
      providerInstanceId: "hermes",
      providerKind: "acpRegistry",
      name: "Hermes",
      models: ["nvidia:gpt-5"],
      defaultModel: "nvidia:gpt-5",
      available: true,
      quota: 1,
      speed: 0.5,
      smartness: 0.7,
    },
  ],
};

const settingsFor = (routing: {
  readonly fallbackOnProviderFailure?: boolean;
  readonly fallbackInstanceId?: string;
  readonly fallbackModel?: string;
  readonly providerFailureCooldownMinutes?: number;
}): ServerSettings =>
  ({
    codeitlab: {
      routing: {
        mode: "auto",
        enforcement: "force",
        ...routing,
      },
    },
  }) as unknown as ServerSettings;

const fakeService = (): RoutingService["Service"] =>
  ({
    catalog: Effect.succeed(catalog),
    decide: () =>
      Effect.succeed({
        id: "route_1",
        decidedAt: "2026-10-23T02:00:00.000Z",
        taskClass: "coding",
        providerInstanceId: "claude",
        providerKind: "claudeAgent",
        model: "sonnet-5",
        reason: "test",
        candidates: [],
        enforced: true,
      }),
    history: () => Effect.succeed([]),
    health: Effect.succeed(undefined),
    checkHealth: Effect.die("unused"),
    recordFallback: () => Effect.void,
  }) as unknown as RoutingService["Service"];

describe("provider failure cooldowns", () => {
  afterEach(() => {
    resetProviderFailures();
  });

  it("cools a provider down until the cooldown expires", () => {
    const recorded = recordProviderFailure({
      providerInstanceId: "claude",
      failureClass: "provider_error",
      reason: "HTTP 404",
      cooldownMinutes: 10,
      nowMs: NOW,
    });
    expect(recorded?.untilMs).toBe(NOW + 10 * 60_000);
    expect(isProviderCoolingDown("claude", NOW + 1_000)).toBe(true);
    expect(isProviderCoolingDown("claude", NOW + 10 * 60_000)).toBe(false);
    expect(coolingDownProviderIds(NOW + 1_000)).toEqual(["claude"]);
    expect(providerFailureFor("claude")?.reason).toBe("HTTP 404");
  });

  it("ignores non-provider failures and empty instance ids", () => {
    expect(
      recordProviderFailure({
        providerInstanceId: "claude",
        failureClass: "validation_error",
        reason: "bad prompt",
        cooldownMinutes: 10,
        nowMs: NOW,
      }),
    ).toBeUndefined();
    expect(
      recordProviderFailure({
        providerInstanceId: "",
        failureClass: "provider_error",
        reason: "boom",
        cooldownMinutes: 10,
        nowMs: NOW,
      }),
    ).toBeUndefined();
    expect(isProviderCoolingDown("claude", NOW)).toBe(false);
  });

  it("replaces an older failure record and keeps the map bounded", () => {
    recordProviderFailure({
      providerInstanceId: "claude",
      failureClass: "provider_error",
      reason: "first",
      cooldownMinutes: 5,
      nowMs: NOW,
    });
    recordProviderFailure({
      providerInstanceId: "claude",
      failureClass: "quota_exhausted",
      reason: "second",
      cooldownMinutes: 30,
      nowMs: NOW + 1_000,
    });
    expect(providerFailureFor("claude")?.failureClass).toBe("quota_exhausted");
    expect(providerFailureFor("claude")?.untilMs).toBe(NOW + 1_000 + 30 * 60_000);
  });
});

describe("automatic provider fallback", () => {
  // Captured outside the Effect programs: the failure cooldown compares against
  // wall-clock time, and TestClock's epoch would look like a 1970 failure.
  let nowMs = 0;
  beforeEach(() => {
    nowMs = DateTime.nowUnsafe().epochMilliseconds;
  });

  afterEach(() => {
    resetActiveRoutingService();
    resetProviderFailures();
  });

  it.effect("routes to the configured backup provider after a failure", () =>
    Effect.gen(function* () {
      registerActiveRoutingService(fakeService());
      recordProviderFailure({
        providerInstanceId: "claude",
        failureClass: "provider_error",
        reason: "HTTP 404",
        cooldownMinutes: 10,
        nowMs,
      });
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude" as never, model: "sonnet-5" },
        readSettings: Effect.succeed(settingsFor({ fallbackInstanceId: "hermes" })),
      });
      expect(result).toEqual({ instanceId: "hermes", model: "nvidia:gpt-5" });
    }),
  );

  it.effect("uses the configured backup model when it exists", () =>
    Effect.gen(function* () {
      registerActiveRoutingService(fakeService());
      recordProviderFailure({
        providerInstanceId: "claude",
        failureClass: "provider_error",
        reason: "HTTP 404",
        cooldownMinutes: 10,
        nowMs,
      });
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude" as never, model: "sonnet-5" },
        readSettings: Effect.succeed(
          settingsFor({ fallbackInstanceId: "hermes", fallbackModel: "nvidia:gpt-5" }),
        ),
      });
      expect(result).toEqual({ instanceId: "hermes", model: "nvidia:gpt-5" });
    }),
  );

  it.effect("keeps the routed provider when fallback is disabled", () =>
    Effect.gen(function* () {
      registerActiveRoutingService(fakeService());
      recordProviderFailure({
        providerInstanceId: "claude",
        failureClass: "provider_error",
        reason: "HTTP 404",
        cooldownMinutes: 10,
        nowMs,
      });
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude" as never, model: "sonnet-5" },
        readSettings: Effect.succeed(
          settingsFor({ fallbackOnProviderFailure: false, fallbackInstanceId: "hermes" }),
        ),
      });
      expect(result).toEqual({ instanceId: "claude", model: "sonnet-5" });
    }),
  );

  it.effect("picks the first usable provider when no backup is configured", () =>
    Effect.gen(function* () {
      registerActiveRoutingService(fakeService());
      recordProviderFailure({
        providerInstanceId: "claude",
        failureClass: "provider_error",
        reason: "HTTP 404",
        cooldownMinutes: 10,
        nowMs,
      });
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude" as never, model: "sonnet-5" },
        readSettings: Effect.succeed(settingsFor({})),
      });
      expect(result).toEqual({ instanceId: "hermes", model: "nvidia:gpt-5" });
    }),
  );

  it.effect("prefer keeps a concrete selection even when its provider is cooling down", () =>
    Effect.gen(function* () {
      registerActiveRoutingService(fakeService());
      recordProviderFailure({
        providerInstanceId: "claude",
        failureClass: "provider_error",
        reason: "HTTP 404",
        cooldownMinutes: 10,
        nowMs,
      });
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude" as never, model: "sonnet-5" },
        readSettings: Effect.succeed({
          codeitlab: {
            routing: {
              mode: "auto",
              enforcement: "prefer",
              fallbackInstanceId: "hermes",
            },
          },
        } as unknown as ServerSettings),
      });
      // The user picked this model: the router must not swap it behind their back.
      expect(result).toBeUndefined();
    }),
  );

  it.effect("keeps a healthy primary provider", () =>
    Effect.gen(function* () {
      registerActiveRoutingService(fakeService());
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude" as never, model: "sonnet-5" },
        readSettings: Effect.succeed(settingsFor({ fallbackInstanceId: "hermes" })),
      });
      expect(result).toEqual({ instanceId: "claude", model: "sonnet-5" });
    }),
  );

  it.effect("uses the configured backup even when it is cooling down", () =>
    Effect.gen(function* () {
      registerActiveRoutingService(fakeService());
      for (const instanceId of ["claude", "hermes"]) {
        recordProviderFailure({
          providerInstanceId: instanceId,
          failureClass: "provider_error",
          reason: "HTTP 404",
          cooldownMinutes: 10,
          nowMs,
        });
      }
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude" as never, model: "sonnet-5" },
        readSettings: Effect.succeed(settingsFor({ fallbackInstanceId: "hermes" })),
      });
      expect(result).toEqual({ instanceId: "hermes", model: "nvidia:gpt-5" });
    }),
  );
});

import { afterEach, describe, expect, it } from "@effect/vitest";
import type { RoutingCatalog, RoutingDecision } from "@codeitlab/core/routing";
import { CodeitlabServiceError } from "@codeitlab/core";
import { RoutingService } from "@codeitlab/core/services";
import type { ServerSettings } from "@t3tools/contracts";
import { createAutoRouteSelection, isAutoRouteSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  decideRouteEnforcement,
  isCompactTurn,
  isPinnedSelection,
  type RouteEnforcementProvider,
} from "./enforcement.ts";
import { registerActiveRoutingService, resetActiveRoutingService } from "./activeRoutingService.ts";
import { resolveEnforcedModelSelection } from "./enforcedRoute.ts";

const providers: ReadonlyArray<RouteEnforcementProvider> = [
  {
    providerInstanceId: "claude",
    available: true,
    models: ["sonnet-5", "opus-5"],
    defaultModel: "sonnet-5",
  },
  {
    providerInstanceId: "codex",
    available: true,
    models: ["gpt-5.5-codex"],
    defaultModel: "gpt-5.5-codex",
  },
  {
    providerInstanceId: "cursor",
    available: false,
    models: ["composer-2"],
    defaultModel: "composer-2",
  },
  { providerInstanceId: "mystery", available: true, models: ["m1"] },
];

describe("route enforcement decision", () => {
  it("never applies when enforcement is off", () => {
    expect(
      decideRouteEnforcement({
        enforcement: "off",
        prompt: "fix the bug",
        current: { instanceId: "claude", model: "sonnet-5" },
        routed: { instanceId: "codex", model: "gpt-5.5-codex" },
        providers,
      }),
    ).toEqual({ applied: false, skipReason: "off" });
  });

  it("never applies on /compact turns, even with force", () => {
    for (const enforcement of ["prefer", "force"] as const) {
      expect(
        decideRouteEnforcement({
          enforcement,
          prompt: "  /COMPACT ",
          current: { instanceId: "claude", model: "sonnet-5" },
          routed: { instanceId: "codex", model: "gpt-5.5-codex" },
          providers,
        }),
      ).toEqual({ applied: false, skipReason: "compact" });
    }
  });

  it("keeps the selection when the routed provider is missing or unavailable", () => {
    const current = { instanceId: "claude", model: "sonnet-5" };
    expect(
      decideRouteEnforcement({
        enforcement: "force",
        prompt: "fix the bug",
        current,
        routed: { instanceId: "nope", model: "x" },
        providers,
      }),
    ).toEqual({ applied: false, skipReason: "provider_unavailable" });
    expect(
      decideRouteEnforcement({
        enforcement: "force",
        prompt: "fix the bug",
        current,
        routed: { instanceId: "cursor", model: "composer-2" },
        providers,
      }),
    ).toEqual({ applied: false, skipReason: "provider_unavailable" });
  });

  it("keeps the selection when the routed model is not in the instance's list", () => {
    expect(
      decideRouteEnforcement({
        enforcement: "force",
        prompt: "fix the bug",
        current: { instanceId: "claude", model: "sonnet-5" },
        routed: { instanceId: "codex", model: "not-a-model" },
        providers,
      }),
    ).toEqual({ applied: false, skipReason: "model_unavailable" });
  });

  it("is a no-op when the routed selection is already active", () => {
    expect(
      decideRouteEnforcement({
        enforcement: "force",
        prompt: "fix the bug",
        current: { instanceId: "codex", model: "gpt-5.5-codex" },
        routed: { instanceId: "codex", model: "gpt-5.5-codex" },
        providers,
      }),
    ).toEqual({ applied: false, skipReason: "already_selected" });
  });

  it("prefer keeps a pinned model but applies to a default-model thread", () => {
    expect(
      decideRouteEnforcement({
        enforcement: "prefer",
        prompt: "fix the bug",
        current: { instanceId: "claude", model: "opus-5" },
        routed: { instanceId: "codex", model: "gpt-5.5-codex" },
        providers,
      }),
    ).toEqual({ applied: false, skipReason: "pinned" });
    expect(
      decideRouteEnforcement({
        enforcement: "prefer",
        prompt: "fix the bug",
        current: { instanceId: "claude", model: "sonnet-5" },
        routed: { instanceId: "codex", model: "gpt-5.5-codex" },
        providers,
      }),
    ).toEqual({
      applied: true,
      selection: { instanceId: "codex", model: "gpt-5.5-codex" },
    });
  });

  it("prefer stays conservative when the instance default is unknown", () => {
    expect(
      decideRouteEnforcement({
        enforcement: "prefer",
        prompt: "fix the bug",
        current: { instanceId: "mystery", model: "m1" },
        routed: { instanceId: "codex", model: "gpt-5.5-codex" },
        providers,
      }),
    ).toEqual({ applied: false, skipReason: "unknown_default" });
  });

  it("force overrides a pinned model", () => {
    expect(
      decideRouteEnforcement({
        enforcement: "force",
        prompt: "fix the bug",
        current: { instanceId: "claude", model: "opus-5" },
        routed: { instanceId: "codex", model: "gpt-5.5-codex" },
        providers,
      }),
    ).toEqual({
      applied: true,
      selection: { instanceId: "codex", model: "gpt-5.5-codex" },
    });
  });

  it("applies with no current selection (new thread)", () => {
    expect(
      decideRouteEnforcement({
        enforcement: "prefer",
        prompt: "fix the bug",
        current: undefined,
        routed: { instanceId: "codex", model: "gpt-5.5-codex" },
        providers,
      }),
    ).toEqual({
      applied: true,
      selection: { instanceId: "codex", model: "gpt-5.5-codex" },
    });
  });

  it("detects compact turns and pinned selections", () => {
    expect(isCompactTurn("/compact")).toBe(true);
    expect(isCompactTurn(" /Compact\n")).toBe(true);
    expect(isCompactTurn("/compact the history")).toBe(false);
    expect(isPinnedSelection({ instanceId: "claude", model: "opus-5" }, providers)).toBe(true);
    expect(isPinnedSelection({ instanceId: "claude", model: "sonnet-5" }, providers)).toBe(false);
    expect(isPinnedSelection({ instanceId: "mystery", model: "m1" }, providers)).toBe(true);
  });
});

const settingsFor = (routing: {
  readonly mode: "manual" | "auto" | "omniroute";
  readonly enforcement: "off" | "prefer" | "force";
}): ServerSettings => ({ codeitlab: { routing } }) as unknown as ServerSettings;

const fakeRoutingService = (
  decide: RoutingService["Service"]["decide"],
  catalog: RoutingService["Service"]["catalog"] = Effect.die("unused"),
): RoutingService["Service"] =>
  ({
    catalog,
    decide,
    history: () => Effect.succeed([]),
    health: Effect.die("unused"),
    checkHealth: Effect.die("unused"),
    scanModels: Effect.die("unused"),
    recordFallback: () => Effect.void,
  }) as RoutingService["Service"];

const current = {
  instanceId: "claude" as never,
  model: "sonnet-5",
};

describe("resolveEnforcedModelSelection wiring", () => {
  afterEach(() => {
    resetActiveRoutingService();
  });

  it.effect("returns the routed selection and logs enforcement", () => {
    const calls: Array<unknown> = [];
    registerActiveRoutingService(
      fakeRoutingService((input) => {
        calls.push(input);
        return Effect.succeed({
          id: "route_1",
          decidedAt: "2026-10-22T12:00:00.000Z",
          taskClass: "coding",
          providerInstanceId: "codex",
          providerKind: "codex",
          model: "gpt-5.5-codex",
          reason: "test",
          candidates: [],
          enforced: true,
        });
      }),
    );
    return Effect.gen(function* () {
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: "project-1",
        attachments: [],
        currentModelSelection: current,
        readSettings: Effect.succeed(settingsFor({ mode: "auto", enforcement: "force" })),
      });
      expect(result).toEqual({ instanceId: "codex", model: "gpt-5.5-codex" });
      expect(calls).toHaveLength(1);
    });
  });

  it.effect("does not call routing in manual mode or with enforcement off", () => {
    let called = 0;
    registerActiveRoutingService(
      fakeRoutingService(() => {
        called += 1;
        return Effect.succeed({
          id: "route_2",
          decidedAt: "2026-10-22T12:00:00.000Z",
          taskClass: "coding",
          providerInstanceId: "codex",
          providerKind: "codex",
          model: "gpt-5.5-codex",
          reason: "test",
          candidates: [],
          enforced: true,
        });
      }),
    );
    return Effect.gen(function* () {
      for (const settings of [
        settingsFor({ mode: "manual", enforcement: "force" }),
        settingsFor({ mode: "auto", enforcement: "off" }),
      ]) {
        const result = yield* resolveEnforcedModelSelection({
          prompt: "fix the bug",
          projectId: null,
          attachments: [],
          currentModelSelection: current,
          readSettings: Effect.succeed(settings),
        });
        expect(result).toBeUndefined();
      }
      expect(called).toBe(0);
    });
  });

  it.effect("keeps the selection when the decision was not enforced or routing failed", () => {
    let mode: "skip" | "fail" = "skip";
    registerActiveRoutingService(
      fakeRoutingService(() =>
        mode === "skip"
          ? Effect.succeed({
              id: "route_3",
              decidedAt: "2026-10-22T12:00:00.000Z",
              taskClass: "coding",
              providerInstanceId: "codex",
              providerKind: "codex",
              model: "gpt-5.5-codex",
              reason: "pinned",
              candidates: [],
              enforced: false,
              skipReason: "pinned",
            })
          : Effect.die(new Error("registry exploded")),
      ),
    );
    return Effect.gen(function* () {
      const settings = settingsFor({ mode: "auto", enforcement: "prefer" });
      expect(
        yield* resolveEnforcedModelSelection({
          prompt: "fix the bug",
          projectId: null,
          attachments: [],
          currentModelSelection: current,
          readSettings: Effect.succeed(settings),
        }),
      ).toBeUndefined();
      mode = "fail";
      expect(
        yield* resolveEnforcedModelSelection({
          prompt: "fix the bug",
          projectId: null,
          attachments: [],
          currentModelSelection: current,
          readSettings: Effect.succeed(settings),
        }),
      ).toBeUndefined();
    });
  });

  it.effect("is a no-op when no routing service is registered", () =>
    Effect.gen(function* () {
      const result = yield* resolveEnforcedModelSelection({
        prompt: "fix the bug",
        projectId: null,
        attachments: [],
        currentModelSelection: current,
        readSettings: Effect.succeed(settingsFor({ mode: "auto", enforcement: "force" })),
      });
      expect(result).toBeUndefined();
    }),
  );
});

const catalogProvider = (input: {
  readonly providerInstanceId: string;
  readonly models: ReadonlyArray<string>;
  readonly defaultModel?: string;
  readonly available: boolean;
}): RoutingCatalog["providers"][number] => ({
  providerInstanceId: input.providerInstanceId,
  providerKind: "codex",
  name: input.providerInstanceId,
  models: input.models,
  ...(input.defaultModel === undefined ? {} : { defaultModel: input.defaultModel }),
  available: input.available,
  quota: 1,
  speed: 0.5,
  smartness: 0.5,
});

const autoRouteCatalog: RoutingCatalog = {
  mode: "manual",
  omniRouteModels: [],
  providers: [
    catalogProvider({ providerInstanceId: "down", models: ["gpt-6"], available: false }),
    catalogProvider({ providerInstanceId: "empty", models: [], available: true }),
    catalogProvider({
      providerInstanceId: "claude-main",
      models: ["claude-haiku", "claude-sonnet-4.5"],
      defaultModel: "claude-sonnet-4.5",
      available: true,
    }),
    catalogProvider({
      providerInstanceId: "codex-main",
      models: ["gpt-5.5-codex"],
      defaultModel: "gpt-5.5-codex",
      available: true,
    }),
  ],
};

const routedDecision = (overrides: Partial<RoutingDecision> = {}): RoutingDecision => ({
  id: "route_auto",
  decidedAt: "2026-10-22T12:00:00.000Z",
  taskClass: "coding",
  providerInstanceId: "codex",
  providerKind: "codex",
  model: "gpt-5.5-codex",
  reason: "test",
  candidates: [],
  enforced: true,
  ...overrides,
});

const sentinel = createAutoRouteSelection();

const resolveSentinel = (
  readSettings: Effect.Effect<ServerSettings | undefined>,
  prompt = "fix the bug",
) =>
  resolveEnforcedModelSelection({
    prompt,
    projectId: null,
    attachments: [],
    currentModelSelection: sentinel,
    readSettings,
  });

describe("resolveEnforcedModelSelection auto router", () => {
  afterEach(() => {
    resetActiveRoutingService();
  });

  it.effect("routes the sentinel with manual mode, enforcement off, and missing settings", () => {
    const calls: Array<unknown> = [];
    registerActiveRoutingService(
      fakeRoutingService((input) => {
        calls.push(input);
        return Effect.succeed(routedDecision());
      }),
    );
    return Effect.gen(function* () {
      for (const settings of [
        settingsFor({ mode: "manual", enforcement: "force" }),
        settingsFor({ mode: "auto", enforcement: "off" }),
        undefined,
      ]) {
        const result = yield* resolveSentinel(Effect.succeed(settings));
        expect(result).toEqual({ instanceId: "codex", model: "gpt-5.5-codex" });
        expect(isAutoRouteSelection(result)).toBe(false);
      }
      expect(calls).toHaveLength(3);
    });
  });

  it.effect("uses the routed selection when the verdict skipped the sentinel (/compact)", () => {
    registerActiveRoutingService(
      fakeRoutingService(() =>
        Effect.succeed(routedDecision({ enforced: false, skipReason: "compact" })),
      ),
    );
    return Effect.gen(function* () {
      const result = yield* resolveSentinel(
        Effect.succeed(settingsFor({ mode: "auto", enforcement: "force" })),
        "/compact",
      );
      expect(result).toEqual({ instanceId: "codex", model: "gpt-5.5-codex" });
      expect(isAutoRouteSelection(result)).toBe(false);
    });
  });

  it.effect("falls back to the catalog default when routing throws or finds no candidate", () => {
    let failure: "throw" | "no_candidate" = "throw";
    registerActiveRoutingService(
      fakeRoutingService(
        () =>
          failure === "throw"
            ? Effect.die(new Error("registry exploded"))
            : Effect.fail(
                new CodeitlabServiceError({
                  operation: "routing.decide",
                  message: "No provider instance is available to route this turn.",
                }),
              ),
        Effect.succeed(autoRouteCatalog),
      ),
    );
    return Effect.gen(function* () {
      for (const next of ["throw", "no_candidate"] as const) {
        failure = next;
        const result = yield* resolveSentinel(
          Effect.succeed(settingsFor({ mode: "auto", enforcement: "force" })),
        );
        expect(result).toEqual({ instanceId: "claude-main", model: "claude-sonnet-4.5" });
        expect(isAutoRouteSelection(result)).toBe(false);
      }
    });
  });

  it.effect("falls back to the provider's first model when it has no default", () => {
    registerActiveRoutingService(
      fakeRoutingService(
        () => Effect.die(new Error("no decision")),
        Effect.succeed({
          mode: "manual",
          omniRouteModels: [],
          providers: [
            catalogProvider({
              providerInstanceId: "solo",
              models: ["model-a", "model-b"],
              available: true,
            }),
          ],
        } satisfies RoutingCatalog),
      ),
    );
    return Effect.gen(function* () {
      const result = yield* resolveSentinel(
        Effect.succeed(settingsFor({ mode: "auto", enforcement: "force" })),
      );
      expect(result).toEqual({ instanceId: "solo", model: "model-a" });
    });
  });

  it.effect("never returns the sentinel, even when a decision echoes it", () => {
    registerActiveRoutingService(
      fakeRoutingService(
        () =>
          Effect.succeed(routedDecision({ providerInstanceId: "codeitlab_auto", model: "auto" })),
        Effect.succeed(autoRouteCatalog),
      ),
    );
    return Effect.gen(function* () {
      const result = yield* resolveSentinel(
        Effect.succeed(settingsFor({ mode: "auto", enforcement: "force" })),
      );
      expect(result).toEqual({ instanceId: "claude-main", model: "claude-sonnet-4.5" });
      expect(isAutoRouteSelection(result)).toBe(false);
    });
  });

  it.effect("falls back when the routed provider cannot serve the turn", () => {
    registerActiveRoutingService(
      fakeRoutingService(
        () =>
          Effect.succeed(routedDecision({ enforced: false, skipReason: "provider_unavailable" })),
        Effect.succeed(autoRouteCatalog),
      ),
    );
    return Effect.gen(function* () {
      const result = yield* resolveSentinel(
        Effect.succeed(settingsFor({ mode: "auto", enforcement: "force" })),
      );
      expect(result).toEqual({ instanceId: "claude-main", model: "claude-sonnet-4.5" });
    });
  });

  it.effect("returns no selection rather than the sentinel when nothing can be resolved", () => {
    registerActiveRoutingService(
      fakeRoutingService(
        () => Effect.die(new Error("no decision")),
        Effect.die(new Error("catalog exploded")),
      ),
    );
    return Effect.gen(function* () {
      const result = yield* resolveSentinel(Effect.succeed(undefined));
      expect(result).toBeUndefined();
    });
  });
});

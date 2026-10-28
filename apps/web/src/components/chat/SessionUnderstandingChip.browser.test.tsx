import type { RoutingCatalog, RoutingDecision } from "@codeitlab/core/routing";
import { ProviderInstanceId } from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { SessionUnderstandingChip } from "./SessionUnderstandingChip";

const catalog: RoutingCatalog = {
  mode: "auto",
  providers: [
    {
      providerInstanceId: "claude",
      providerKind: "claude",
      name: "Claude Code",
      models: ["claude-sonnet-4.5"],
      available: true,
      quota: 0.4,
      speed: 0.7,
      smartness: 0.92,
    },
  ],
  omniRouteModels: [],
};

const decision: RoutingDecision = {
  id: "decision-1",
  decidedAt: "2026-10-25T00:00:00.000Z",
  taskClass: "coding",
  providerInstanceId: "claude",
  providerKind: "claude",
  model: "claude-sonnet-4.5",
  reason: "coding task: claude-sonnet-4.5 has the best smartness for the class.",
  candidates: [
    {
      providerInstanceId: "claude",
      providerKind: "claude",
      model: "claude-sonnet-4.5",
      quota: 0.4,
      smartness: 0.92,
      speed: 0.7,
      score: 0.78,
      available: true,
    },
  ],
};

const mock = vi.hoisted(() => ({
  routing: null as unknown,
  projection: null as unknown,
  threadRef: null as unknown,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeItLabRouting: (() => mock.routing) as never,
}));

// The composer chip reads the thread the route points at. The test route has no
// thread params, so both hooks are answered here.
vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useThreadProjection: (() => mock.projection) as never,
}));

vi.mock(import("../../hooks/useThreadRouteTarget"), async (original) => ({
  ...(await original()),
  useThreadRouteRef: (() => mock.threadRef) as never,
}));

function routingView(overrides: {
  decision?: RoutingDecision | null;
  source?: "server" | "local";
}) {
  return {
    data: catalog,
    history: overrides.decision === null ? [] : [overrides.decision ?? decision],
    health: {
      checkedAt: "2026-10-25T00:00:00.000Z",
      intervalMinutes: 30,
      nextCheckAt: "2026-10-25T00:30:00.000Z",
      source: "scheduled",
      entries: [],
    },
    healthSource: "server",
    healthIsPending: false,
    refreshHealth: () => {},
    checkHealth: async () => null,
    decide: async () => null,
    source: overrides.source ?? "server",
    error: null,
    isPending: false,
    refresh: () => {},
  };
}

function setup(routing: ReturnType<typeof routingView>) {
  mock.routing = routing;
  mock.projection = null;
  mock.threadRef = null;
}

function chip(
  decisionInput: RoutingDecision | null,
  context: {
    usedTokens: number | null;
    maxTokens: number | null;
  } | null,
  selected: { providerInstanceId: string; model: string } | null,
) {
  return (
    <SessionUnderstandingChip
      catalog={catalog}
      context={context}
      decision={decisionInput}
      selected={selected}
    />
  );
}

describe("SessionUnderstandingChip", () => {
  it("renders nothing before the router has decided", async () => {
    setup(routingView({ decision: null }));
    await using screen = await renderUi(chip(null, null, null));

    expect(screen.container.querySelector("[data-session-understanding]")).toBeNull();
    expect(screen.container.textContent).toBe("");
  });

  it("names the task class and exposes the router reason as its description", async () => {
    setup(routingView({}));
    await using screen = await renderUi(chip(decision, null, null));

    const badge = screen.container.querySelector<HTMLElement>("[data-session-understanding-chip]");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("coding · heuristic");
    expect(badge?.getAttribute("title")).toBe(decision.reason);
    const describedBy = badge?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(decision.reason);
  });

  it("shows the selected model's context usage when a source provides it", async () => {
    setup(routingView({}));
    await using screen = await renderUi(
      chip(
        decision,
        { usedTokens: 12_000, maxTokens: 200_000 },
        {
          providerInstanceId: "claude",
          model: "claude-sonnet-4.5",
        },
      ),
    );

    const usage = screen.container.querySelector("[data-session-understanding-context]");
    expect(usage?.textContent).toBe("12,000 / 200,000 tokens");
  });

  it("leaves context out when the surface has no source for it", async () => {
    setup(routingView({}));
    await using screen = await renderUi(
      chip(decision, null, { providerInstanceId: "claude", model: "claude-sonnet-4.5" }),
    );

    expect(screen.container.querySelector("[data-session-understanding-context]")).toBeNull();
    expect(screen.container.textContent).not.toContain("not used yet");
  });
});

describe("SessionUnderstandingChip in the composer picker", () => {
  function picker() {
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={ProviderInstanceId.make("claude")}
        model="claude-sonnet-4.5"
        lockedProvider={null}
        instanceEntries={[]}
        modelOptionsByInstance={new Map()}
        isComposerOwned
        onInstanceModelChange={() => {}}
      />
    );
  }

  it("renders beside the trigger without becoming part of its name", async () => {
    setup(routingView({}));
    await using screen = await renderUi(picker());

    const trigger = screen.container.querySelector("[data-chat-provider-model-picker]");
    const badge = screen.container.querySelector("[data-session-understanding-chip]");
    expect(trigger).not.toBeNull();
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("coding · heuristic");
    expect(trigger?.textContent).not.toContain("heuristic");
    expect(trigger?.getAttribute("aria-label")).toBeNull();
    expect(trigger?.contains(badge ?? null)).toBe(false);
  });

  it("shows how much of the window the thread used", async () => {
    setup(routingView({}));
    mock.threadRef = { environmentId: "local", threadId: "thread-1" };
    // useThreadProjection returns the environment thread, whose .projection is
    // what the chip folds over.
    mock.projection = {
      projection: {
        thread: { id: "thread-1", activeProviderThreadId: "pt-1" },
        contextTransfers: [],
        providerTurns: [
          {
            tokenUsage: {
              usedTokens: 12_000,
              maxTokens: 200_000,
              updatedAt: "2026-10-25T10:00:00.000Z",
            },
          },
        ],
        providerThreads: [],
      },
    };
    await using screen = await renderUi(picker());

    const usage = screen.container.querySelector("[data-session-understanding-context]");
    expect(usage?.textContent).toBe("12,000 / 200,000 tokens");
  });

  it("leaves the context out when the thread has not reported usage", async () => {
    setup(routingView({}));
    await using screen = await renderUi(picker());

    expect(screen.container.querySelector("[data-session-understanding-context]")).toBeNull();
  });

  it("waits for server routing instead of showing a preview verdict", async () => {
    setup(routingView({ source: "local" }));
    await using screen = await renderUi(picker());

    expect(screen.container.querySelector("[data-session-understanding]")).toBeNull();
  });
});

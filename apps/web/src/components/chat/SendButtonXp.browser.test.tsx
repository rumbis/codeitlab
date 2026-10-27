import type { CodeItLabXpState } from "@codeitlab/contracts";
import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render, type Screen } from "../../../test/render";
import { updateCodeItLabEffects } from "../../codeitlab/effectsSettings";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { SendButtonXp } from "./SendButtonXp";

const mock = vi.hoisted(() => ({
  xp: null as unknown,
  record: vi.fn(async (_input: unknown): Promise<unknown> => null),
  threadState: null as unknown,
  routeRef: null as unknown,
  plays: [] as string[],
}));

vi.mock(import("../../codeitlab/xp"), async (original) => ({
  ...(await original()),
  useCodeItLabXp: (() => mock.xp) as never,
}));

vi.mock(import("../../state/threads"), () => ({
  useEnvironmentThread: (() => mock.threadState) as never,
}));

vi.mock(import("../../hooks/useThreadRouteTarget"), async (original) => ({
  ...(await original()),
  useThreadRouteRef: (() => mock.routeRef) as never,
}));

vi.mock(import("../../codeitlab/audio"), () => ({
  playCodeItLabSfx: (name: string) => {
    mock.plays.push(name);
  },
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
}));

vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

const RUN_ID = "run-1";

function xpState(overrides: Partial<CodeItLabXpState> = {}): CodeItLabXpState {
  return {
    totalXp: 130,
    level: 3,
    levelLabel: "Level 3",
    xpIntoLevel: 130,
    xpForNextLevel: 300,
    progress: 0.43,
    streakDays: 4,
    bestStreak: 6,
    bestStreakDay: "2026-10-20",
    todayXp: 20,
    awardedEvents: 12,
    ...overrides,
  };
}

function run(status: string) {
  return { id: RUN_ID, status };
}

function threadState(runs: ReadonlyArray<{ id: string; status: string }>) {
  return {
    data: Option.some({ runs }),
    status: "live",
    error: Option.none(),
    history: {},
  };
}

function setup(
  input: {
    readonly state?: CodeItLabXpState | null;
    readonly runs?: ReadonlyArray<{ id: string; status: string }>;
  } = {},
) {
  mock.record.mockReset();
  mock.record.mockResolvedValue(null);
  mock.plays.length = 0;
  const state = input.state === undefined ? xpState() : input.state;
  mock.xp = { state, record: mock.record, refresh: () => {} };
  mock.threadState = threadState(input.runs ?? []);
  mock.routeRef = { environmentId: "env-1", threadId: "thread-1" };
}

async function completeObservedRun(screen: Screen) {
  mock.threadState = threadState([run("completed")]);
  await screen.rerender(<SendButtonXp />);
}

function stubReducedMotion(matches: boolean): Disposable {
  const list = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
  const spy = vi.spyOn(window, "matchMedia").mockReturnValue(list);
  return { [Symbol.dispose]: () => spy.mockRestore() };
}

function enableSfx(): Disposable {
  updateCodeItLabEffects({ sfxEnabled: true });
  return { [Symbol.dispose]: () => updateCodeItLabEffects({ sfxEnabled: false }) };
}

const composerProps = {
  compact: false,
  canOperateThread: true,
  pendingAction: null,
  isRunning: false,
  canInterrupt: false,
  showPlanFollowUpPrompt: false,
  promptHasText: true,
  isSendBusy: false,
  sendDisabledReason: null,
  isConnecting: false,
  isEnvironmentUnavailable: false,
  isPreparingWorktree: false,
  hasSendableContent: true,
  preserveComposerFocusOnPointerDown: true,
  onPreviousPendingQuestion: () => {},
  onInterrupt: () => {},
  onImplementPlanInNewThread: () => {},
  onSubmitMessage: () => {},
} as const;

describe("send button XP", () => {
  it("draws the level ring and names it for screen readers", async () => {
    setup();
    await using screen = await render(<SendButtonXp />);

    const ring = screen.container.querySelector<HTMLElement>('[data-xp-ring="true"]');
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute("aria-label")).toBe("Level 3, 130 of 300 XP");
    expect(ring?.getAttribute("data-xp-progress")).toBe("0.43");
    expect(ring?.textContent).toContain("3");

    const fill = screen.container.querySelector<SVGCircleElement>("[data-xp-ring-offset]");
    const expectedOffset = 2 * Math.PI * 10 * (1 - 0.43);
    expect(Number(fill?.getAttribute("data-xp-ring-offset"))).toBeCloseTo(expectedOffset, 5);
  });

  it("shows the streak in tabular figures and says when there is none", async () => {
    setup();
    await using screen = await render(<SendButtonXp />);

    const streak = screen.container.querySelector<HTMLElement>('[data-xp-streak="true"]');
    expect(streak?.textContent).toBe("4-day streak");
    expect(streak?.className).toContain("tabular-nums");

    mock.xp = { ...(mock.xp as { state: CodeItLabXpState }), state: xpState({ streakDays: 0 }) };
    await screen.rerender(<SendButtonXp />);
    expect(
      screen.container.querySelector<HTMLElement>('[data-xp-streak="true"]')?.textContent,
    ).toBe("no streak yet");
  });

  it("shows one +XP feedback for an awarded completed run and then settles", async () => {
    setup({ runs: [run("running")] });
    mock.record.mockResolvedValue({
      awarded: true,
      state: xpState({ totalXp: 140, xpIntoLevel: 140, progress: 0.47 }),
    });
    await using screen = await render(<SendButtonXp />);
    expect(mock.record).not.toHaveBeenCalled();

    await completeObservedRun(screen);

    await vi.waitFor(() => expect(mock.record).toHaveBeenCalledTimes(1));
    expect(mock.record.mock.calls[0]?.[0]).toEqual({
      kind: "turn-completed",
      eventId: RUN_ID,
    });
    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-xp-feedback="10"]')).not.toBeNull(),
    );
    const feedback = screen.container.querySelector<HTMLElement>('[data-xp-feedback="10"]');
    expect(feedback?.textContent).toBe("+10 XP");
    await vi.waitFor(() => expect(feedback?.getAttribute("data-xp-feedback-settled")).toBe("true"));
    // Default effects settings mute SFX, so the award is silent.
    expect(mock.plays).toEqual([]);

    await screen.rerender(<SendButtonXp />);
    expect(mock.record).toHaveBeenCalledTimes(1);
    expect(screen.container.querySelectorAll("[data-xp-feedback]")).toHaveLength(1);
  });

  it("shows the XP number without motion when reduced motion is requested", async () => {
    using _motion = stubReducedMotion(true);
    setup({ runs: [run("running")] });
    mock.record.mockResolvedValue({
      awarded: true,
      state: xpState({ totalXp: 140, xpIntoLevel: 140, progress: 0.47 }),
    });
    await using screen = await render(<SendButtonXp />);

    await completeObservedRun(screen);

    await vi.waitFor(() =>
      expect(screen.container.querySelector('[data-xp-feedback="10"]')).not.toBeNull(),
    );
    const feedback = screen.container.querySelector<HTMLElement>('[data-xp-feedback="10"]');
    expect(feedback?.getAttribute("data-xp-feedback-settled")).toBe("true");
    expect(feedback?.textContent).toBe("+10 XP");
    expect(feedback?.className).not.toContain("translate-y-1");
    expect(feedback?.className).not.toContain("opacity-0");
  });

  it("renders nothing before the server has answered", async () => {
    setup({ state: null });
    await using screen = await render(<SendButtonXp />);

    expect(screen.container.querySelector("[data-send-button-xp]")).toBeNull();
    expect(screen.container.textContent).toBe("");
  });

  it("does not award XP when the send button is clicked", async () => {
    setup({ runs: [run("completed")] });
    await using _screen = await render(<ComposerPrimaryActions {...composerProps} />);

    await userEvent.click(page.getByRole("button", { name: "Submit message" }));

    expect(mock.record).not.toHaveBeenCalled();
  });

  it("plays the success cue only when Effects has SFX enabled", async () => {
    using _sfx = enableSfx();
    setup({ runs: [run("running")] });
    mock.record.mockResolvedValue({
      awarded: true,
      state: xpState({ totalXp: 140, xpIntoLevel: 140, progress: 0.47 }),
    });
    await using screen = await render(<SendButtonXp />);

    await completeObservedRun(screen);

    await vi.waitFor(() => expect(mock.plays).toEqual(["success"]));
  });
});

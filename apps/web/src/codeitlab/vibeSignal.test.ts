import { describe, expect, it } from "vite-plus/test";

import { vibeSignalTone } from "./vibeSignal";

describe("vibeSignalTone", () => {
  it("asks for attention while the agent is blocked on the user", () => {
    expect(vibeSignalTone({ awaiting: true, running: true })).toBe("awaiting");
  });

  it("stays awaiting after the run settles, so a pending request is never silent", () => {
    expect(vibeSignalTone({ awaiting: true, running: false })).toBe("awaiting");
  });

  // A run blocked on an approval is still "running" everywhere else in the app:
  // the elapsed timer keeps counting and isWorking stays true. The room must not
  // report progress it can see is stalled, so awaiting outranks running rather
  // than being merged with it.
  it("outranks running instead of blending into it", () => {
    const blocked = vibeSignalTone({ awaiting: true, running: true });
    const busy = vibeSignalTone({ awaiting: false, running: true });
    expect(blocked).not.toBe(busy);
  });

  it("reports progress while the agent works", () => {
    expect(vibeSignalTone({ awaiting: false, running: true })).toBe("working");
  });

  it("rests when nothing is pending", () => {
    expect(vibeSignalTone({ awaiting: false, running: false })).toBe("idle");
  });
});

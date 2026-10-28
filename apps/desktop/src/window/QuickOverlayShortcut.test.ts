import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_QUICK_OVERLAY_ACCELERATOR,
  QUICK_OVERLAY_ACCELERATOR_ENV,
  quickOverlayAccelerator,
  registerQuickOverlayShortcut,
} from "./QuickOverlayShortcut.ts";

function shortcutStub(register: (accelerator: string, callback: () => void) => boolean) {
  return { register } as const;
}

describe("quick overlay accelerator", () => {
  it("uses the documented default when the environment has no override", () => {
    expect(quickOverlayAccelerator({})).toBe(DEFAULT_QUICK_OVERLAY_ACCELERATOR);
    expect(quickOverlayAccelerator({ [QUICK_OVERLAY_ACCELERATOR_ENV]: "  " })).toBe(
      DEFAULT_QUICK_OVERLAY_ACCELERATOR,
    );
  });

  it("honours a configured accelerator", () => {
    expect(quickOverlayAccelerator({ [QUICK_OVERLAY_ACCELERATOR_ENV]: " Control+Alt+K " })).toBe(
      "Control+Alt+K",
    );
  });
});

describe("quick overlay registration", () => {
  it("registers the accelerator and wires the open callback", () => {
    let opened = 0;
    let registeredAccelerator = "";
    const registration = registerQuickOverlayShortcut(
      shortcutStub((accelerator, callback) => {
        registeredAccelerator = accelerator;
        callback();
        return true;
      }),
      "CommandOrControl+Shift+Space",
      () => {
        opened += 1;
      },
    );
    expect(registration).toEqual({ registered: true, message: null });
    expect(registeredAccelerator).toBe("CommandOrControl+Shift+Space");
    expect(opened).toBe(1);
  });

  it("reports a taken accelerator instead of throwing", () => {
    const registration = registerQuickOverlayShortcut(
      shortcutStub(() => false),
      "CommandOrControl+Shift+Space",
      () => undefined,
    );
    expect(registration.registered).toBe(false);
    expect(registration.message).toContain("already used");
  });

  it("reports a thrown registration error instead of failing startup", () => {
    const registration = registerQuickOverlayShortcut(
      shortcutStub(() => {
        throw new Error("no display server");
      }),
      "CommandOrControl+Shift+Space",
      () => undefined,
    );
    expect(registration.registered).toBe(false);
    expect(registration.message).toContain("no display server");
  });
});

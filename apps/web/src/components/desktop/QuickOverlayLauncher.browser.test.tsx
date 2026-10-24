import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { QuickOverlayLauncher, quickOverlayHref } from "./QuickOverlayLauncher";

describe("QuickOverlayLauncher", () => {
  it("builds a new-thread href that preserves the prompt", () => {
    expect(quickOverlayHref("fix the login bug")).toBe("/new?prompt=fix%20the%20login%20bug");
  });

  it("opens on the chord, submits with Enter, and closes", async () => {
    const onSubmit = vi.fn();
    await using screen = await render(<QuickOverlayLauncher onSubmit={onSubmit} />, {
      router: "/",
    });

    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    await userEvent.keyboard("{Meta>}{Shift>} {/Shift}{/Meta}");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();

    await userEvent.type(screen.getByRole("textbox"), "  ship the overlay  ");
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("ship the overlay");
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses with Escape without submitting", async () => {
    const onSubmit = vi.fn();
    await using screen = await render(<QuickOverlayLauncher onSubmit={onSubmit} />, {
      router: "/",
    });

    await userEvent.keyboard("{Meta>}{Shift>} {/Shift}{/Meta}");
    await userEvent.type(screen.getByRole("textbox"), "never mind");
    await userEvent.keyboard("{Escape}");
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

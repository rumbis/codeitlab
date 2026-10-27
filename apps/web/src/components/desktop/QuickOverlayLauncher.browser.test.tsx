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

  it("keeps Tab inside the overlay and hands focus back on Escape", async () => {
    const onSubmit = vi.fn();
    const opener = document.createElement("button");
    opener.textContent = "Opener";
    document.body.append(opener);
    opener.focus();
    await using screen = await render(<QuickOverlayLauncher onSubmit={onSubmit} />, {
      router: "/",
    });

    await userEvent.keyboard("{Meta>}{Shift>} {/Shift}{/Meta}");
    await vi.waitFor(() => expect(document.activeElement?.tagName).toBe("TEXTAREA"));
    // A prompt enables Open thread, so the trap has three stops to wrap through.
    await userEvent.type(screen.getByRole("textbox"), "trap me");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.textContent).toBe("Cancel");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.textContent).toBe("Open thread");
    // Past the last control the trap wraps to the first, not the page behind.
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    // The prompt field is the surface's main control, so the wrap has to show a ring.
    const ring = getComputedStyle(document.activeElement as Element);
    expect(ring.outlineStyle).not.toBe("none");
    expect(ring.outlineWidth).not.toBe("0px");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement?.textContent).toBe("Open thread");

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
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

import type { CodeItLabWallpaperSettings } from "@codeitlab/core/wallpaper";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabWallpaperPage } from "./CodeItLabWallpaperPage";

const mock = vi.hoisted(() => ({
  wallpaper: {
    enabled: false,
    preset: "dusk",
    imageUrl: "",
    opacity: 35,
  } as CodeItLabWallpaperSettings,
  updates: [] as Array<{ wallpaper: CodeItLabWallpaperSettings }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { wallpaper: mock.wallpaper },
    environmentId: null,
    update: (patch: { wallpaper: CodeItLabWallpaperSettings }) => {
      mock.updates.push(patch);
      mock.wallpaper = patch.wallpaper;
      return { wallpaper: mock.wallpaper };
    },
  })) as never,
}));

describe("wallpaper page", () => {
  it("turns the wallpaper on", async () => {
    mock.wallpaper = { enabled: false, preset: "dusk", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabWallpaperPage />);
    await userEvent.click(screen.getByText("Use a wallpaper"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.wallpaper.enabled).toBe(true);
  });

  it("switches preset and previews it", async () => {
    mock.wallpaper = { enabled: true, preset: "dusk", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabWallpaperPage />);
    await userEvent.click(screen.getByText("Aurora"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.wallpaper.preset).toBe("aurora");
  });

  it("moves through presets with the arrow keys from one tab stop", async () => {
    mock.wallpaper = { enabled: true, preset: "dusk", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabWallpaperPage />);
    const buttons = [...screen.container.querySelectorAll("button")];
    const dusk = buttons.find((button) => button.textContent?.trim() === "Dusk");
    const aurora = buttons.find((button) => button.textContent?.trim() === "Aurora");
    expect(dusk?.tabIndex).toBe(0);
    expect(aurora?.tabIndex).toBe(-1);
    dusk?.focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(document.activeElement).toBe(aurora));
    expect(mock.updates.at(-1)?.wallpaper.preset).toBe("aurora");
  });

  it("disables the action that would change nothing", async () => {
    mock.wallpaper = { enabled: true, preset: "dusk", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabWallpaperPage />);
    const apply = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Apply wallpaper",
    );
    const off = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Turn off",
    );
    expect(apply?.disabled).toBe(true);
    expect(off?.disabled).toBe(false);
    expect(apply?.getAttribute("aria-describedby")).toBe("wallpaper-state");
    expect(screen.container.querySelector("#wallpaper-state")?.textContent).toContain(
      "Turn off is the action that changes something.",
    );
    await userEvent.click(off!);
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.wallpaper.enabled).toBe(false);
  });

  it("keeps Apply disabled until a custom URL can show", async () => {
    mock.wallpaper = { enabled: false, preset: "custom", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabWallpaperPage />);
    const apply = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Apply wallpaper",
    );
    expect(apply?.disabled).toBe(true);
    expect(screen.container.querySelector("#wallpaper-state")?.textContent).toContain(
      "A custom wallpaper needs an image URL before it can be shown.",
    );
  });

  it("asks for a URL before a custom wallpaper can show", async () => {
    mock.wallpaper = { enabled: true, preset: "custom", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabWallpaperPage />);
    expect(screen.getByText(/needs an image URL/)).not.toBeNull();
  });

  it("switches preset from the keyboard", async () => {
    mock.wallpaper = { enabled: true, preset: "dusk", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabWallpaperPage />);
    const aurora = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Aurora",
    );
    expect(aurora?.type).toBe("button");
    aurora?.focus();
    expect(document.activeElement).toBe(aurora);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.wallpaper.preset).toBe("aurora");
  });
});

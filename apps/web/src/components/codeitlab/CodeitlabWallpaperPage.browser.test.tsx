import type { CodeitlabWallpaperSettings } from "@codeitlab/core/wallpaper";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabWallpaperPage } from "./CodeitlabWallpaperPage";

const mock = vi.hoisted(() => ({
  wallpaper: {
    enabled: false,
    preset: "dusk",
    imageUrl: "",
    opacity: 35,
  } as CodeitlabWallpaperSettings,
  updates: [] as Array<{ wallpaper: CodeitlabWallpaperSettings }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { wallpaper: mock.wallpaper },
    environmentId: null,
    update: (patch: { wallpaper: CodeitlabWallpaperSettings }) => {
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
    await using screen = await renderUi(<CodeitlabWallpaperPage />);
    await userEvent.click(screen.getByText("Use a wallpaper"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.wallpaper.enabled).toBe(true);
  });

  it("switches preset and previews it", async () => {
    mock.wallpaper = { enabled: true, preset: "dusk", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabWallpaperPage />);
    await userEvent.click(screen.getByText("Aurora"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.wallpaper.preset).toBe("aurora");
  });

  it("asks for a URL before a custom wallpaper can show", async () => {
    mock.wallpaper = { enabled: true, preset: "custom", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabWallpaperPage />);
    expect(screen.getByText(/needs an image URL/)).not.toBeNull();
  });

  it("switches preset from the keyboard", async () => {
    mock.wallpaper = { enabled: true, preset: "dusk", imageUrl: "", opacity: 35 };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabWallpaperPage />);
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

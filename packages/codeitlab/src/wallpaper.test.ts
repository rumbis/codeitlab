import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CodeitlabWallpaperSettings,
  wallpaperBackground,
  wallpaperLabel,
  type CodeitlabWallpaperSettings as Settings,
} from "./wallpaper.ts";

const decode = Schema.decodeSync(CodeitlabWallpaperSettings);
const settings = (patch: Partial<Settings>): Settings => ({ ...decode({}), ...patch });

describe("wallpapers", () => {
  it("is off by default", () => {
    expect(decode({}).enabled).toBe(false);
    expect(wallpaperBackground(decode({}))).toBeNull();
  });

  it("returns a gradient for a preset and caps opacity", () => {
    const background = wallpaperBackground(
      settings({ enabled: true, preset: "dusk", opacity: 95 }),
    );
    expect(background?.backgroundImage).toContain("linear-gradient");
    expect(background?.opacity).toBe(60);
  });

  it("requires a URL for a custom image and quotes it", () => {
    expect(wallpaperBackground(settings({ enabled: true, preset: "custom" }))).toBeNull();
    const background = wallpaperBackground(
      settings({ enabled: true, preset: "custom", imageUrl: 'https://example.com/a "b".png' }),
    );
    expect(background?.backgroundImage).toBe('url("https://example.com/a %22b%22.png")');
  });

  it("labels presets for the settings page", () => {
    expect(wallpaperLabel(settings({ preset: "aurora" }))).toBe("Aurora");
    expect(wallpaperLabel(settings({ preset: "custom" }))).toContain("no URL");
  });
});

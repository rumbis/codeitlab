import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Wallpapers are opt-in artwork behind the app chrome. They never replace a
 * surface's background: the sidebar and the main card stay translucent on top,
 * so text keeps its contrast instead of sitting directly on a photograph.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CODEITLAB_WALLPAPER_PRESETS = ["dusk", "aurora", "grid", "paper", "custom"] as const;
export const CodeItLabWallpaperPreset = Schema.Literals(CODEITLAB_WALLPAPER_PRESETS);
export type CodeItLabWallpaperPreset = typeof CodeItLabWallpaperPreset.Type;

export const CodeItLabWallpaperSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  preset: CodeItLabWallpaperPreset.pipe(Schema.withDecodingDefault(Effect.succeed("dusk"))),
  /** Only used when preset is `custom`; anything else is ignored. */
  imageUrl: TrimmedDefault(""),
  /** 0–100; the layer is capped at 60 so it can never fight the UI. */
  opacity: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(35))),
});
export type CodeItLabWallpaperSettings = typeof CodeItLabWallpaperSettings.Type;

const PRESET_BACKGROUNDS: Record<Exclude<CodeItLabWallpaperPreset, "custom">, string> = {
  dusk: "linear-gradient(160deg, #1b1b3a 0%, #3a1f4d 45%, #6b2f4a 100%)",
  aurora: "linear-gradient(150deg, #062a2a 0%, #14435a 45%, #4b2a6b 100%)",
  grid: "repeating-linear-gradient(0deg, #14161f 0 23px, #1c2030 23px 24px), repeating-linear-gradient(90deg, #14161f 0 23px, #1c2030 23px 24px)",
  paper: "linear-gradient(160deg, #efe7d8 0%, #e2d6c3 55%, #d8c8b2 100%)",
};

export interface WallpaperBackground {
  readonly backgroundImage: string;
  readonly opacity: number;
}

export function wallpaperBackground(
  settings: CodeItLabWallpaperSettings,
): WallpaperBackground | null {
  if (!settings.enabled) return null;
  const opacity = Math.min(
    60,
    Math.max(0, Number.isFinite(settings.opacity) ? settings.opacity : 35),
  );
  if (settings.preset === "custom") {
    const url = settings.imageUrl.trim();
    if (url === "") return null;
    // Quote the URL so a comma or space in it cannot break the CSS value.
    return { backgroundImage: `url("${url.replaceAll('"', "%22")}")`, opacity };
  }
  return { backgroundImage: PRESET_BACKGROUNDS[settings.preset], opacity };
}

/** Short human label used by the settings page and its preview. */
export function wallpaperLabel(settings: CodeItLabWallpaperSettings): string {
  if (settings.preset === "custom") {
    return settings.imageUrl.trim() === "" ? "Custom image (no URL yet)" : "Custom image";
  }
  return settings.preset[0]!.toUpperCase() + settings.preset.slice(1);
}

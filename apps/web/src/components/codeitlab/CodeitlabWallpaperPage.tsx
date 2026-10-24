import {
  CODEITLAB_WALLPAPER_PRESETS,
  wallpaperBackground,
  wallpaperLabel,
} from "@codeitlab/core/wallpaper";

import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CodeitlabCard, CodeitlabSectionHeading } from "./CodeitlabPrimitives";

/**
 * Wallpaper settings with a live preview. The preview uses the same resolver as
 * the real layer, so what the box shows is what the shell paints.
 */
export function CodeitlabWallpaperPage() {
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  const wallpaper = codeitlab.wallpaper;
  const background = wallpaperBackground({ ...wallpaper, enabled: true });

  const patch = (next: Partial<typeof wallpaper>) => {
    update({ wallpaper: { ...wallpaper, ...next } });
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeitlabSectionHeading
        description="Opt-in artwork behind the app chrome. While a wallpaper is on, the sidebar and the main card turn translucent so text keeps a solid backing; opacity is capped so it can never fight the interface."
        eyebrow="CodeItLab // wallpaper"
        title="Wallpaper"
      />

      <CodeitlabCard className="flex flex-col gap-4 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={wallpaper.enabled}
            onChange={(event) => patch({ enabled: event.currentTarget.checked })}
            type="checkbox"
          />
          Use a wallpaper
        </label>

        <div className="flex flex-wrap gap-2">
          {CODEITLAB_WALLPAPER_PRESETS.map((preset) => {
            const sample = wallpaperBackground({ ...wallpaper, enabled: true, preset });
            const selected = wallpaper.preset === preset;
            return (
              <Button
                type="button"
                aria-pressed={selected}
                className="h-auto"
                key={preset}
                onClick={() => patch({ preset })}
                size="sm"
                variant={selected ? "default" : "outline"}
              >
                <span className="flex flex-col items-start gap-2">
                  <span
                    aria-hidden
                    className="h-8 w-20 rounded-sm border border-border/60 bg-cover bg-center"
                    style={
                      sample === null ? undefined : { backgroundImage: sample.backgroundImage }
                    }
                  />
                  {wallpaperLabel({ ...wallpaper, preset })}
                </span>
              </Button>
            );
          })}
        </div>

        {wallpaper.preset === "custom" ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="wallpaper-url">
              Image URL
            </label>
            <Input
              id="wallpaper-url"
              onChange={(event) => patch({ imageUrl: event.currentTarget.value })}
              placeholder="https://…"
              value={wallpaper.imageUrl}
            />
            {background === null ? (
              <p className="mt-1 text-2xs text-muted-foreground">
                A custom wallpaper needs an image URL before it can be shown.
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="wallpaper-opacity">
            Opacity: {Math.round(wallpaper.opacity)}%
          </label>
          <input
            aria-label="Wallpaper opacity"
            className="settings-slider w-full"
            id="wallpaper-opacity"
            max={60}
            min={0}
            onChange={(event) => patch({ opacity: Number(event.currentTarget.value) })}
            type="range"
            value={wallpaper.opacity}
          />
          <p className="text-2xs text-muted-foreground">
            Capped at 60%. The surfaces stay translucent, so text contrast does not depend on the
            artwork.
          </p>
        </div>

        <div
          aria-label="Wallpaper preview"
          className="relative h-28 overflow-hidden rounded-md border border-border/60 bg-background"
          role="img"
        >
          {background === null ? null : (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: background.backgroundImage,
                opacity: background.opacity / 100,
              }}
            />
          )}
          <div className="absolute inset-x-3 bottom-3 rounded-md bg-background/84 p-2 text-xs backdrop-blur">
            Preview: {wallpaperLabel(wallpaper)} · {wallpaper.enabled ? "on" : "off"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => patch({ enabled: true })} size="sm">
            Apply wallpaper
          </Button>
          <Button
            type="button"
            onClick={() => patch({ enabled: false })}
            size="sm"
            variant="outline"
          >
            Turn off
          </Button>
        </div>
      </CodeitlabCard>
    </div>
  );
}

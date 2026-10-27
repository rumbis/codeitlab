import {
  CODEITLAB_WALLPAPER_PRESETS,
  wallpaperBackground,
  wallpaperLabel,
} from "@codeitlab/core/wallpaper";

import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import {
  CodeItLabCard,
  CodeItLabSectionHeading,
  CodeItLabSlider,
  CodeItLabToggleGroup,
} from "./CodeItLabPrimitives";

/**
 * Wallpaper settings with a live preview. The preview uses the same resolver as
 * the real layer, so what the box shows is what the shell paints.
 */
export function CodeItLabWallpaperPage() {
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const wallpaper = codeitlab.wallpaper;
  const background = wallpaperBackground({ ...wallpaper, enabled: true });

  const patch = (next: Partial<typeof wallpaper>) => {
    update({ wallpaper: { ...wallpaper, ...next } });
  };

  // Both buttons change state, so each disables once it would do nothing, and the
  // line they point at says which one is the live action right now.
  const applyReason = wallpaper.enabled
    ? "The wallpaper is already on."
    : background === null
      ? "A custom wallpaper needs an image URL before it can be shown."
      : null;
  const stateLine = wallpaper.enabled
    ? "The wallpaper is on; Turn off is the action that changes something."
    : (applyReason ?? "The wallpaper is off; Apply turns it on.");

  return (
    <div className="flex flex-col gap-6">
      <CodeItLabSectionHeading
        description="Opt-in artwork behind the app chrome. While a wallpaper is on, the sidebar and the main card turn translucent so text keeps a solid backing; opacity is capped so it can never fight the interface."
        eyebrow="CodeItLab // wallpaper"
        title="Wallpaper"
      />

      <CodeItLabCard className="flex flex-col gap-4 p-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            aria-label="Use a wallpaper"
            checked={wallpaper.enabled}
            onCheckedChange={(checked) => patch({ enabled: checked === true })}
          />
          Use a wallpaper
        </label>

        <CodeItLabToggleGroup
          idleVariant="outline"
          label="Wallpaper preset"
          onChange={(preset) => patch({ preset })}
          options={CODEITLAB_WALLPAPER_PRESETS.map((preset) => {
            const sample = wallpaperBackground({ ...wallpaper, enabled: true, preset });
            return {
              value: preset,
              className: "h-auto",
              label: (
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
              ),
            };
          })}
          selectedVariant="default"
          size="sm"
          value={wallpaper.preset}
        />

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
          <CodeItLabSlider
            id="wallpaper-opacity"
            label="Wallpaper opacity"
            max={60}
            min={0}
            onChange={(opacity) => patch({ opacity })}
            step={1}
            value={wallpaper.opacity}
            valueLabel={`${Math.round(wallpaper.opacity)}%`}
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-describedby="wallpaper-state"
            type="button"
            disabled={applyReason !== null}
            onClick={() => patch({ enabled: true })}
            size="sm"
          >
            Apply wallpaper
          </Button>
          <Button
            aria-describedby="wallpaper-state"
            type="button"
            disabled={!wallpaper.enabled}
            onClick={() => patch({ enabled: false })}
            size="sm"
            variant="outline"
          >
            Turn off
          </Button>
          <p aria-live="polite" className="text-2xs text-muted-foreground" id="wallpaper-state">
            {stateLine}
          </p>
        </div>
      </CodeItLabCard>
    </div>
  );
}

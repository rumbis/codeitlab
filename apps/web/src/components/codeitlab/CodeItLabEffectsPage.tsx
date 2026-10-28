import { RotateCcwIcon, Volume2Icon } from "lucide-react";

import { DEFAULT_CODEITLAB_SETTINGS } from "@codeitlab/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  playCodeItLabSfx,
  previewCodeItLabSfx,
  syncCodeItLabAmbient,
  unlockCodeItLabAudio,
} from "../../codeitlab/audio";
import {
  useCodeItLabEffectsSettings,
  useCodeItLabEffectsWriter,
} from "../../codeitlab/effectsSettings";
import type { CodeItLabSfxName } from "../../codeitlab/audio";
import {
  CodeItLabCard,
  CodeItLabSectionHeading,
  CodeItLabSettingRow,
  CodeItLabSlider,
} from "./CodeItLabPrimitives";

const QUALITY_LABELS = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

const SFX_EVENTS: ReadonlyArray<{
  readonly name: CodeItLabSfxName;
  readonly label: string;
  readonly description: string;
}> = [
  { name: "click", label: "Clicks", description: "Buttons, toggles, and panel navigation." },
  { name: "send", label: "Send", description: "Submitting a prompt to the agent." },
  { name: "success", label: "Success", description: "A turn completes without errors." },
  {
    name: "error",
    label: "Errors",
    description: "Failed commands, tool errors, and error toasts.",
  },
];

export function CodeItLabEffectsPage() {
  const settings = useCodeItLabEffectsSettings();
  const update = useCodeItLabEffectsWriter();
  const reset = () => update(DEFAULT_CODEITLAB_SETTINGS.effects);
  // Reset is only offered when it would change something, and Preview is only
  // offered when sound is on: both would otherwise be a click that does nothing.
  const atDefaults =
    JSON.stringify(settings) === JSON.stringify(DEFAULT_CODEITLAB_SETTINGS.effects);

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="effects">
      <CodeItLabSectionHeading
        eyebrow="Effects"
        title="Ambient 3D and synthesised sound"
        description="Both effects are per-device and saved locally immediately; the connected environment receives the same block when its settings RPC is available. They are designed to stay out of the way: no continuous full-app repaint, no audio before a user gesture."
        action={
          <Button
            aria-describedby="effects-reset-state"
            disabled={atDefaults}
            onClick={reset}
            size="sm"
            variant="ghost"
          >
            <RotateCcwIcon className="size-3.5" />
            Reset
          </Button>
        }
      />

      <p aria-live="polite" className="text-2xs text-muted-foreground" id="effects-reset-state">
        {atDefaults
          ? "Everything is already at its default, so Reset is disabled."
          : "Reset returns both effects to their defaults."}
      </p>

      <CodeItLabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">3D</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">Ambient scenes</p>
          </div>
          <Badge size="sm" variant={settings.threeD === "off" ? "outline" : "success"}>
            {QUALITY_LABELS[settings.threeD]}
          </Badge>
        </div>
        <CodeItLabSettingRow
          title="Scene quality"
          description="Off removes the canvas entirely. The scene is capped at the frame limit below, pauses offscreen and when the tab is hidden, and never mounts on phones."
          control={
            <Select
              value={settings.threeD}
              onValueChange={(value) => {
                if (value === "off" || value === "low" || value === "medium" || value === "high") {
                  update({ threeD: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="3D scene quality">
                <SelectValue>{QUALITY_LABELS[settings.threeD]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {Object.entries(QUALITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} hideIndicator value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <CodeItLabSettingRow
          title="Frame cap"
          description="The render loop throttles to this value. 30 fps is the default; lower it on battery."
          control={
            <CodeItLabSlider
              id="codeitlab-effects-fps"
              label="3D frame cap"
              max={60}
              min={15}
              onChange={(maxFps) => update({ maxFps })}
              step={15}
              value={settings.maxFps}
              valueLabel={`${settings.maxFps} fps`}
            />
          }
        />
        <CodeItLabSettingRow
          title="Respect reduced motion"
          description="When the OS asks for reduced motion, render one static frame instead of animating."
          control={
            <Switch
              aria-label="Respect reduced motion"
              checked={settings.respectReducedMotion}
              onCheckedChange={(checked) => update({ respectReducedMotion: checked })}
            />
          }
        />
      </CodeItLabCard>

      <CodeItLabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-cyan/80">SFX</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">Synthesised sound</p>
          </div>
          <Badge size="sm" variant={settings.sfxEnabled ? "success" : "outline"}>
            {settings.sfxEnabled ? "enabled" : "muted"}
          </Badge>
        </div>
        <p
          aria-live="polite"
          className="px-4 pt-3 text-2xs text-muted-foreground"
          id="effects-sfx-state"
        >
          {settings.sfxEnabled
            ? "Sound is on. Preview plays one event without changing its switch."
            : "Sound is muted, so Preview is disabled; the master switch below turns it on."}
        </p>
        <CodeItLabSettingRow
          title="Master switch"
          description="Off until you enable it here or in the top bar. Browsers only allow audio after the first click or key press."
          control={
            <Switch
              aria-label="Enable CodeItLab sound effects"
              checked={settings.sfxEnabled}
              onCheckedChange={(checked) => {
                update({ sfxEnabled: checked });
                if (checked) {
                  unlockCodeItLabAudio();
                  playCodeItLabSfx("click");
                  syncCodeItLabAmbient();
                }
              }}
            />
          }
        />
        <CodeItLabSettingRow
          title="Volume"
          description="Applied to every generated sound. The ambient hum is mixed well below the one-shots."
          control={
            <CodeItLabSlider
              id="codeitlab-effects-volume"
              label="Sound volume"
              max={100}
              min={0}
              onChange={(value) => update({ sfxVolume: value / 100 })}
              step={5}
              value={Math.round(settings.sfxVolume * 100)}
              valueLabel={`${Math.round(settings.sfxVolume * 100)}%`}
            />
          }
        />
        <CodeItLabSettingRow
          title="Ambient hum"
          description="A low filtered drone while the app is open. Off by default; stops when the tab is hidden."
          control={
            <Switch
              aria-label="Ambient hum"
              checked={settings.sfxEvents.ambient}
              onCheckedChange={(checked) => {
                update({ sfxEvents: { ...settings.sfxEvents, ambient: checked } });
                unlockCodeItLabAudio();
                syncCodeItLabAmbient();
              }}
            />
          }
        />
        <div className="border-t border-border/50 px-4 py-3">
          <p className="codeitlab-mono-label text-muted-foreground">Per-event</p>
          <div className="mt-2 flex flex-col gap-3">
            {SFX_EVENTS.map((event) => (
              <div
                key={event.name}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{event.label}</p>
                  <p className="text-xs text-muted-foreground">{event.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    aria-describedby="effects-sfx-state"
                    disabled={!settings.sfxEnabled}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      unlockCodeItLabAudio();
                      previewCodeItLabSfx(event.name);
                    }}
                  >
                    <Volume2Icon className="size-3.5" />
                    Preview
                  </Button>
                  <Switch
                    aria-label={`${event.label} sound`}
                    checked={settings.sfxEvents[event.name]}
                    onCheckedChange={(checked) =>
                      update({
                        sfxEvents: { ...settings.sfxEvents, [event.name]: checked },
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </CodeItLabCard>

      <p className="text-xs text-muted-foreground">
        Saved under <code className="font-mono">codeitlab:effects:v1</code> in this browser and
        mirrored into the environment&apos;s CodeItLab settings block.
      </p>
    </div>
  );
}

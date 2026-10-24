import { RotateCcwIcon, Volume2Icon } from "lucide-react";

import { DEFAULT_CODEITLAB_SETTINGS } from "@t3tools/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  playCodeitlabSfx,
  previewCodeitlabSfx,
  syncCodeitlabAmbient,
  unlockCodeitlabAudio,
} from "../../codeitlab/audio";
import {
  useCodeitlabEffectsSettings,
  useCodeitlabEffectsWriter,
} from "../../codeitlab/effectsSettings";
import type { CodeitlabSfxName } from "../../codeitlab/audio";
import {
  CodeitlabCard,
  CodeitlabSectionHeading,
  CodeitlabSettingRow,
  CodeitlabSlider,
} from "./CodeitlabPrimitives";

const QUALITY_LABELS = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

const SFX_EVENTS: ReadonlyArray<{
  readonly name: CodeitlabSfxName;
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

export function CodeitlabEffectsPage() {
  const settings = useCodeitlabEffectsSettings();
  const update = useCodeitlabEffectsWriter();
  const reset = () => update(DEFAULT_CODEITLAB_SETTINGS.effects);

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="effects">
      <CodeitlabSectionHeading
        eyebrow="Effects"
        title="Ambient 3D and synthesised sound"
        description="Both effects are per-device and saved locally immediately; the connected environment receives the same block when its settings RPC is available. They are designed to stay out of the way: no continuous full-app repaint, no audio before a user gesture."
        action={
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcwIcon className="size-3.5" />
            Reset
          </Button>
        }
      />

      <CodeitlabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">3D</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">Ambient scenes</p>
          </div>
          <Badge size="sm" variant={settings.threeD === "off" ? "outline" : "success"}>
            {QUALITY_LABELS[settings.threeD]}
          </Badge>
        </div>
        <CodeitlabSettingRow
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
        <CodeitlabSettingRow
          title="Frame cap"
          description="The render loop throttles to this value. 30 fps is the default; lower it on battery."
          control={
            <CodeitlabSlider
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
        <CodeitlabSettingRow
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
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-cyan/80">SFX</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">Synthesised sound</p>
          </div>
          <Badge size="sm" variant={settings.sfxEnabled ? "success" : "outline"}>
            {settings.sfxEnabled ? "enabled" : "muted"}
          </Badge>
        </div>
        <CodeitlabSettingRow
          title="Master switch"
          description="The mute control in the top bar toggles the same setting. Browsers only allow audio after the first click or key press."
          control={
            <Switch
              aria-label="Enable CodeitLab sound effects"
              checked={settings.sfxEnabled}
              onCheckedChange={(checked) => {
                update({ sfxEnabled: checked });
                if (checked) {
                  unlockCodeitlabAudio();
                  playCodeitlabSfx("click");
                  syncCodeitlabAmbient();
                }
              }}
            />
          }
        />
        <CodeitlabSettingRow
          title="Volume"
          description="Applied to every generated sound. The ambient hum is mixed well below the one-shots."
          control={
            <CodeitlabSlider
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
        <CodeitlabSettingRow
          title="Ambient hum"
          description="A low filtered drone while the app is open. Off by default; stops when the tab is hidden."
          control={
            <Switch
              aria-label="Ambient hum"
              checked={settings.sfxEvents.ambient}
              onCheckedChange={(checked) => {
                update({ sfxEvents: { ...settings.sfxEvents, ambient: checked } });
                unlockCodeitlabAudio();
                syncCodeitlabAmbient();
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
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      unlockCodeitlabAudio();
                      previewCodeitlabSfx(event.name);
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
      </CodeitlabCard>

      <p className="text-xs text-muted-foreground">
        Saved under <code className="font-mono">codeitlab:effects:v1</code> in this browser and
        mirrored into the environment&apos;s CodeitLab settings block.
      </p>
    </div>
  );
}

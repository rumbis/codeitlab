import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  playCodeItLabSfx,
  syncCodeItLabAmbient,
  unlockCodeItLabAudio,
} from "../../codeitlab/audio";
import {
  useCodeItLabEffectsSettings,
  useCodeItLabEffectsWriter,
} from "../../codeitlab/effectsSettings";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Visible mute control for the synthesised SFX. Lives in the chat top bar and
 * the CodeItLab hero so sound is never a hidden preference.
 */
export function CodeItLabSoundToggle({ className }: { readonly className?: string }) {
  const settings = useCodeItLabEffectsSettings();
  const update = useCodeItLabEffectsWriter();
  const enabled = settings.sfxEnabled;
  const label = enabled ? "Mute CodeItLab sounds" : "Enable CodeItLab sounds";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            aria-label={label}
            aria-pressed={enabled}
            className={cn(className)}
            data-codeitlab-sound-toggle={enabled ? "on" : "off"}
            onClick={() => {
              const next = !enabled;
              update({ sfxEnabled: next });
              if (next) {
                unlockCodeItLabAudio();
                playCodeItLabSfx("click");
                syncCodeItLabAmbient();
              }
            }}
            size="icon-sm"
            variant="ghost-muted"
          />
        }
      >
        {enabled ? (
          <Volume2Icon className="size-4" />
        ) : (
          <VolumeXIcon className="size-4 opacity-70" />
        )}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

import { Volume2Icon, VolumeXIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  playCodeitlabSfx,
  syncCodeitlabAmbient,
  unlockCodeitlabAudio,
} from "../../codeitlab/audio";
import {
  useCodeitlabEffectsSettings,
  useCodeitlabEffectsWriter,
} from "../../codeitlab/effectsSettings";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Visible mute control for the synthesised SFX. Lives in the chat top bar and
 * the CodeitLab hero so sound is never a hidden preference.
 */
export function CodeitlabSoundToggle({ className }: { readonly className?: string }) {
  const settings = useCodeitlabEffectsSettings();
  const update = useCodeitlabEffectsWriter();
  const enabled = settings.sfxEnabled;
  const label = enabled ? "Mute CodeitLab sounds" : "Enable CodeitLab sounds";
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
                unlockCodeitlabAudio();
                playCodeitlabSfx("click");
                syncCodeitlabAmbient();
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

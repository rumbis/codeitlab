import { useNavigate } from "@tanstack/react-router";
import { TerminalSquareIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { playCodeItLabSfx, unlockCodeItLabAudio } from "../../codeitlab/audio";

/** Top-bar entry point to the CodeItLab panel. */
export function CodeItLabTopBarButton() {
  const navigate = useNavigate();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            aria-label="Open CodeItLab panel"
            data-codeitlab-topbar-button
            onClick={() => {
              unlockCodeItLabAudio();
              playCodeItLabSfx("click");
              void navigate({ to: "/settings/codeitlab" });
            }}
            size="icon-sm"
            variant="ghost-muted"
          />
        }
      >
        <TerminalSquareIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">CodeItLab panel</TooltipPopup>
    </Tooltip>
  );
}

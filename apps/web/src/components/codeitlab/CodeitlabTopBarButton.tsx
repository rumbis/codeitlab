import { useNavigate } from "@tanstack/react-router";
import { TerminalSquareIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { playCodeitlabSfx, unlockCodeitlabAudio } from "../../codeitlab/audio";

/** Top-bar entry point to the CodeitLab panel. */
export function CodeitlabTopBarButton() {
  const navigate = useNavigate();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            aria-label="Open CodeitLab panel"
            data-codeitlab-topbar-button
            onClick={() => {
              unlockCodeitlabAudio();
              playCodeitlabSfx("click");
              void navigate({ to: "/settings/codeitlab" });
            }}
            size="icon-sm"
            variant="ghost-muted"
          />
        }
      >
        <TerminalSquareIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">CodeitLab panel</TooltipPopup>
    </Tooltip>
  );
}

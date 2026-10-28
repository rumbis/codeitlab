import { useNavigate } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export const AGENT_TEAMS_ROUTE = "/settings/codeitlab/team";

/**
 * Composer entry point for agent teams. It opens the team setup rather than
 * starting anything: a team run needs a preset and a task, and pretending a
 * single click could start one would hide the brief the architect receives.
 */
export function ComposerTeamsEntry() {
  const navigate = useNavigate();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Start an agent team"
            data-codeitlab-teams-entry="true"
            onClick={() => void navigate({ to: AGENT_TEAMS_ROUTE })}
            onPointerDown={(event) => event.preventDefault()}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <UsersIcon />
      </TooltipTrigger>
      <TooltipPopup>Agent teams</TooltipPopup>
    </Tooltip>
  );
}

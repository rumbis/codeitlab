import { HandshakeIcon } from "lucide-react";
import { useState } from "react";

import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { EngagementDeliveryDialog } from "../codeitlab/EngagementDeliveryDialog";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Opens the reviewed delivery dialog for the thread on screen. It renders
 * nothing outside a thread route, and the dialog mounts only while open, so the
 * bridge and the engagement list are read when the coder asks for them.
 */
export function EngagementDeliveryButton() {
  const threadRef = useThreadRouteRef();
  const [open, setOpen] = useState(false);
  if (threadRef === null) return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<Button size="icon-sm" type="button" variant="ghost" />}
          aria-label="Deliver to a marketplace engagement"
          onClick={() => setOpen(true)}
        >
          <HandshakeIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipPopup>Deliver to a marketplace engagement</TooltipPopup>
      </Tooltip>
      {open ? (
        <EngagementDeliveryDialog
          onOpenChange={setOpen}
          open={open}
          threadId={threadRef.threadId}
        />
      ) : null}
    </>
  );
}

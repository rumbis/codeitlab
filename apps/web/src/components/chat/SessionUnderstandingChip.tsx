import type { RoutingCatalog, RoutingDecision } from "@codeitlab/core/routing";
import { useId } from "react";

import {
  buildSessionUnderstanding,
  sessionContextLabel,
  type SessionContextUsage,
} from "../../codeitlab/modelsSession";
import { Badge } from "../ui/badge";

/**
 * The composer's copy of the Models page's session-understanding chip. Both
 * surfaces call buildSessionUnderstanding, so the label and the reason cannot
 * drift. The picker has no thread projection to read usage from, so it passes
 * context: null and only the class and reason render.
 */
export function SessionUnderstandingChip({
  decision,
  context,
  selected,
  hiddenModelsByInstance,
  catalog,
}: {
  decision: RoutingDecision | null;
  context: SessionContextUsage | null;
  selected: { providerInstanceId: string; model: string } | null;
  hiddenModelsByInstance?: Readonly<Record<string, readonly string[]>>;
  catalog: RoutingCatalog;
}) {
  const reasonId = useId();
  const session = buildSessionUnderstanding({
    catalog,
    decision,
    context,
    selected,
    hiddenModelsByInstance: hiddenModelsByInstance ?? {},
  });
  const chip = session.chip;
  // A chip without a reason is noise in the composer; the Models page is where
  // the no-decision state is explained.
  if (chip === null) return null;
  // Without a context source the fold would say "not used yet" even though the
  // truth is "this surface cannot see the thread", which would be a lie.
  const selectedRow = context === null ? null : (session.rows.find((row) => row.selected) ?? null);
  const contextLabel = selectedRow === null ? null : sessionContextLabel(selectedRow);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-session-understanding="true">
      <Badge
        aria-describedby={reasonId}
        data-session-understanding-chip="true"
        size="sm"
        title={chip.reason}
        variant="secondary"
      >
        {chip.label}
      </Badge>
      {contextLabel === null ? null : (
        <span
          className="truncate text-2xs tabular-nums text-muted-foreground"
          data-session-understanding-context="true"
        >
          {contextLabel}
        </span>
      )}
      <span className="sr-only" id={reasonId}>
        {chip.reason}
      </span>
    </span>
  );
}

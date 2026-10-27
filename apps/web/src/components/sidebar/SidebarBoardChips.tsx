import { CODEITLAB_BOARD_COLUMNS, activeBoardTasks } from "@codeitlab/core/board";
import { Link } from "@tanstack/react-router";
import { memo } from "react";

import { useCodeItLabTasks } from "../../codeitlab/api";
import { BOARD_COLUMN_LABELS, settingsBoardTasks } from "../../codeitlab/board";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";

/**
 * The board's state at a glance: one chip per column with its active count.
 * Hidden when the board is empty so a quiet sidebar stays quiet, and every chip
 * is a real link to /board so the row is keyboard reachable.
 *
 * The database is the shared copy, so the chips read it whenever it answered;
 * settings stays the fallback, exactly like the board page. Otherwise a board
 * stored in the database would look empty in the sidebar.
 */
export const SidebarBoardChips = memo(function SidebarBoardChips() {
  const { codeitlab } = useCodeItLabSettingsWriter();
  const remote = useCodeItLabTasks();
  const source =
    remote.source === "server" && remote.data.length > 0
      ? remote.data
      : settingsBoardTasks(codeitlab);
  const active = activeBoardTasks(source);
  if (active.length === 0) return null;
  return (
    <div aria-label="Board counts" className="flex items-center gap-1 px-2 pb-1" role="group">
      {CODEITLAB_BOARD_COLUMNS.map((column) => {
        const count = active.filter((task) => task.column === column).length;
        const label = BOARD_COLUMN_LABELS[column];
        return (
          <Link
            aria-label={`${label}: ${count} ${count === 1 ? "task" : "tasks"}`}
            className="rounded-sm px-1 text-2xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            key={column}
            title={label}
            to="/board"
          >
            {label.slice(0, 2)}
            <span className="ml-0.5 text-foreground">{count}</span>
          </Link>
        );
      })}
    </div>
  );
});

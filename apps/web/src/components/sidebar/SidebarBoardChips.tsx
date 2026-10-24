import { CODEITLAB_BOARD_COLUMNS, activeBoardTasks } from "@codeitlab/core/board";
import { Link } from "@tanstack/react-router";
import { memo } from "react";

import { BOARD_COLUMN_LABELS } from "../../codeitlab/board";
import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";

/**
 * The board's state at a glance: one chip per column with its active count.
 * Hidden when the board is empty so a quiet sidebar stays quiet, and every chip
 * is a real link to /board so the row is keyboard reachable.
 */
export const SidebarBoardChips = memo(function SidebarBoardChips() {
  const { codeitlab } = useCodeitlabSettingsWriter();
  const active = activeBoardTasks(codeitlab.board.tasks);
  if (active.length === 0) return null;
  return (
    <div aria-label="Board counts" className="flex items-center gap-1 px-2 pb-1">
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

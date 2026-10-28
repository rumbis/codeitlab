// @effect-diagnostics nodeBuiltinImport:off - reads the board page to check its keyboard path.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * A card that moves to another column takes the button that moved it with it. The
 * board therefore has to hand focus back and say where the card went, which is easy
 * to lose when a new arrow is written straight to persistTasks.
 */
const boardRoot =
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)) + "/../components/codeitlab";

const page = NodeFS.readFileSync(NodePath.join(boardRoot, "CodeItLabBoardPage.tsx"), "utf8");

describe("board keyboard movement", () => {
  it("routes both arrows through the focus-restoring move", () => {
    expect(page).toContain("onClick={() => moveTask(task, PREVIOUS_COLUMN[column]!)}");
    expect(page).toContain("onClick={() => moveTask(task, NEXT_COLUMN[column]!)}");
    expect(page).not.toContain("persistTasks(\n                                  moveBoardTask(");
  });

  it("keeps the moved card reachable and speaks the new column", () => {
    expect(page).toContain("document.getElementById(`board-details-${focusTaskId}`)?.focus()");
    expect(page).toContain("id={`board-details-${task.id}`}");
    expect(page).toContain('role="status"');
    expect(page).toContain("Moved “${task.title}” to ${BOARD_COLUMN_LABELS[target]}.");
  });
});

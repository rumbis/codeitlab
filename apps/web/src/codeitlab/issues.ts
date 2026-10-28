import type { CodeItLabIssue } from "@codeitlab/core/issues";
import type { CodeItLabTask } from "@codeitlab/core/board";

import { createBoardTask } from "./board";

let sequence = 0;

export function createIssue(now: Date, title = ""): CodeItLabIssue {
  sequence += 1;
  const stamp = now.toISOString();
  return {
    id: `issue-${now.getTime().toString(36)}-${sequence.toString(36)}`,
    title,
    body: "",
    status: "open",
    source: "",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Board tasks carry the issue body and source so the thread does not lose them. */
export function issueToBoardTask(issue: CodeItLabIssue, now: Date): CodeItLabTask {
  const task = createBoardTask(now, issue.title.trim());
  return {
    ...task,
    notes: [issue.body.trim(), issue.source.trim() === "" ? "" : `Source: ${issue.source.trim()}`]
      .filter((part) => part !== "")
      .join("\n\n"),
  };
}

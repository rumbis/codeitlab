import { describe, expect, it } from "vite-plus/test";

import { createIssue, issueToBoardTask } from "./issues.ts";

const now = new Date("2026-10-24T12:00:00.000Z");

describe("issues", () => {
  it("creates an open issue with timestamps and a unique id", () => {
    const first = createIssue(now, "Board loses state");
    expect(first.status).toBe("open");
    expect(first.createdAt).toBe(now.toISOString());
    expect(first.id).not.toBe(createIssue(now).id);
  });

  it("turns an issue into a pending board task with its body and source", () => {
    const issue = {
      ...createIssue(now, "Board loses state"),
      body: "Steps to reproduce",
      source: "https://example.com/1",
    };
    const task = issueToBoardTask(issue, now);
    expect(task.column).toBe("pending");
    expect(task.title).toBe("Board loses state");
    expect(task.notes).toContain("Steps to reproduce");
    expect(task.notes).toContain("Source: https://example.com/1");
  });
});

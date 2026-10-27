import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  CodeItLabIssuesSettings,
  activeIssues,
  issueBrief,
  issueTitleProblem,
  type CodeItLabIssue,
} from "./issues.ts";

const decode = Schema.decodeSync(CodeItLabIssuesSettings);

const issue = (patch: Partial<CodeItLabIssue>): CodeItLabIssue => ({
  ...decode({}).issues[0]!,
  id: "issue-1",
  title: "Board loses archive state",
  body: "",
  status: "open",
  source: "",
  createdAt: "",
  updatedAt: "",
  ...patch,
});

describe("issues", () => {
  it("decodes an empty block", () => {
    expect(decode({}).issues).toEqual([]);
  });

  it("requires a short title", () => {
    expect(issueTitleProblem("Real problem")).toBeNull();
    expect(issueTitleProblem("  ")).toContain("title");
    expect(issueTitleProblem("x".repeat(201))).toContain("200");
  });

  it("keeps only open and in-progress issues active", () => {
    expect(
      activeIssues([
        issue({ id: "a", status: "open" }),
        issue({ id: "b", status: "inProgress" }),
        issue({ id: "c", status: "closed" }),
      ]).map((entry) => entry.id),
    ).toEqual(["a", "b"]);
  });

  it("writes a scoped brief and does not pretend to close the issue", () => {
    const brief = issueBrief(
      issue({ body: "Steps: open /board", source: "https://example.com/1" }),
    );
    expect(brief).toContain("Fix this issue: Board loses archive state");
    expect(brief).toContain("Steps: open /board");
    expect(brief).toContain("Source: https://example.com/1");
    expect(brief).toContain("Keep the change scoped");
  });
});

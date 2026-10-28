import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Local issues: a small, offline tracker for the problems you meet while working.
 *
 * This is deliberately not a GitHub client. Reading a real tracker needs a
 * network call and a token, and pretending to sync would be worse than saying
 * "local only". An issue can be sent to the board as a task or to a thread as a
 * brief, so it feeds the work that already exists.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CODEITLAB_ISSUE_STATUSES = ["open", "inProgress", "closed"] as const;
export const CodeItLabIssueStatus = Schema.Literals(CODEITLAB_ISSUE_STATUSES);
export type CodeItLabIssueStatus = typeof CodeItLabIssueStatus.Type;

export const CodeItLabIssue = Schema.Struct({
  id: TrimmedDefault("issue-1"),
  title: TrimmedDefault(""),
  body: TrimmedDefault(""),
  status: CodeItLabIssueStatus.pipe(Schema.withDecodingDefault(Effect.succeed("open"))),
  /** Optional link to where the issue really lives; never fetched. */
  source: TrimmedDefault(""),
  createdAt: TrimmedDefault(""),
  updatedAt: TrimmedDefault(""),
});
export type CodeItLabIssue = typeof CodeItLabIssue.Type;

export const CodeItLabIssuesSettings = Schema.Struct({
  issues: Schema.Array(CodeItLabIssue).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeItLabIssuesSettings = typeof CodeItLabIssuesSettings.Type;

export function issueTitleProblem(title: string): string | null {
  if (title.trim() === "") return "Give the issue a title.";
  if (title.trim().length > 200) return "Keep the title under 200 characters.";
  return null;
}

export function activeIssues(issues: ReadonlyArray<CodeItLabIssue>): ReadonlyArray<CodeItLabIssue> {
  return issues.filter((issue) => issue.status !== "closed");
}

/** The prompt sent to a thread: the issue as context, not as an instruction to close it. */
export function issueBrief(issue: CodeItLabIssue): string {
  return [
    `Fix this issue: ${issue.title.trim()}`,
    ...(issue.body.trim() === "" ? [] : ["", issue.body.trim()]),
    ...(issue.source.trim() === "" ? [] : ["", `Source: ${issue.source.trim()}`]),
    "",
    "Rules:",
    "- Reproduce it or point at the failing code before changing anything.",
    "- Keep the change scoped to this issue; list unrelated problems you notice instead of fixing them.",
    "- Say what you could not verify.",
  ].join("\n");
}

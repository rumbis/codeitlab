import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Deploy targets are saved commands, not a second runner: running one opens a
 * normal thread whose prompt names the command, so the deploy happens in the
 * project's own terminal, with the user's approvals and a visible transcript.
 * Secrets stay where they already live (the credentials proxy or the CLI's own
 * login); nothing here stores or logs them.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeitlabDeployTarget = Schema.Struct({
  id: TrimmedDefault("deploy-1"),
  name: TrimmedDefault("Deploy"),
  /** Shell command the thread should run, e.g. `vercel deploy --prod`. */
  command: TrimmedDefault(""),
  /** Optional note shown before running, e.g. the URL shape or a precondition. */
  notes: TrimmedDefault(""),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type CodeitlabDeployTarget = typeof CodeitlabDeployTarget.Type;

export const CodeitlabDeploySettings = Schema.Struct({
  targets: Schema.Array(CodeitlabDeployTarget).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeitlabDeploySettings = typeof CodeitlabDeploySettings.Type;

/** A target needs a name and a single-line command; the command is the whole point. */
export function deployTargetIssue(target: CodeitlabDeployTarget): string | null {
  if (target.name.trim() === "") return "Give the target a name so you can recognise it later.";
  if (target.command.trim() === "") return "Add the command this target should run.";
  if (target.command.includes("\n"))
    return "Keep the command on one line; put extra steps in the notes.";
  return null;
}

/**
 * The brief deliberately forbids inventing a URL or pretending to deploy: the
 * thread must report what the CLI actually printed, and ask before installing or
 * authenticating anything.
 */
export function buildDeployBrief(target: CodeitlabDeployTarget): string {
  const command = target.command.trim();
  const notes = target.notes.trim();
  return [
    `Deploy this project with the "${target.name.trim()}" target.`,
    "",
    "Run this command in the project root and report the real output:",
    "",
    "```sh",
    command,
    "```",
    "",
    "Rules:",
    "- Do not invent a deployment URL; report the one the command printed, or say there is none.",
    "- If the CLI is missing or not authenticated, stop and ask before installing or logging in.",
    "- If the command fails, show the error and the smallest next step; do not retry with a different provider.",
    "- Do not paste secrets or tokens into the transcript.",
    ...(notes === "" ? [] : ["", `Notes: ${notes}`]),
  ].join("\n");
}

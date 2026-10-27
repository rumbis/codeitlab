import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The profile is the one place a person says what they are here to build and
 * what they are good at. It is written by the human, never inferred by an
 * agent, and it is local: the marketplace only sees it if the user copies it
 * into a job brief.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabProfileSettings = Schema.Struct({
  /** What the person wants the work to be about. */
  interestDomain: TrimmedDefault(""),
  /** What they can already do without help. */
  skillset: TrimmedDefault(""),
});
export type CodeItLabProfileSettings = typeof CodeItLabProfileSettings.Type;

export function profileIsEmpty(profile: CodeItLabProfileSettings): boolean {
  return profile.interestDomain.trim() === "" && profile.skillset.trim() === "";
}

/**
 * A short block for a thread or bot brief. Labelled as user-declared context so
 * an agent does not treat it as an instruction, and omitted entirely when the
 * profile is empty.
 */
export function profileBrief(profile: CodeItLabProfileSettings): ReadonlyArray<string> {
  const lines: Array<string> = [];
  if (profile.interestDomain.trim() !== "") {
    lines.push(`Interest domain (declared by the user): ${profile.interestDomain.trim()}`);
  }
  if (profile.skillset.trim() !== "") {
    lines.push(`Skillset (declared by the user): ${profile.skillset.trim()}`);
  }
  return lines.length === 0 ? [] : ["", "Who this work is for:", ...lines];
}

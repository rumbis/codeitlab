import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The profile is the one place a person says who they are and what they have
 * built. It is written by the human, never inferred by an agent, and it stays
 * local: the marketplace only sees it when the user chooses to publish it.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

/** One job the person held: where, what they did, and when. */
export const CodeItLabWorkHistoryEntry = Schema.Struct({
  /** Employer or client. */
  company: TrimmedDefault(""),
  /** The title they held, or the role they played. */
  role: TrimmedDefault(""),
  /** Free-form span such as "2021 - 2023"; a person remembers years, not dates. */
  period: TrimmedDefault(""),
  /** What they actually did, in their own words. */
  summary: TrimmedDefault(""),
});
export type CodeItLabWorkHistoryEntry = typeof CodeItLabWorkHistoryEntry.Type;

export const CodeItLabProfileSettings = Schema.Struct({
  /** Who the person is: the name they want on their profile. */
  fullName: TrimmedDefault(""),
  /** One line under the name, the way a CV opens. */
  headline: TrimmedDefault(""),
  /** Where they are, so a business can tell what hours they keep. */
  location: TrimmedDefault(""),
  /** What the person wants the work to be about. */
  interestDomain: TrimmedDefault(""),
  /** What they can already do without help. */
  skillset: TrimmedDefault(""),
  /** The jobs they have done, newest first. */
  workHistory: Schema.Array(CodeItLabWorkHistoryEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /**
   * Whether the profile may be shown to businesses. Off until the person says
   * so: a profile is their own material, and consent is the whole feature.
   */
  visibleToBusinesses: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type CodeItLabProfileSettings = typeof CodeItLabProfileSettings.Type;

function filled(value: string | undefined): boolean {
  return (value ?? "").trim() !== "";
}

/** An entry counts once it says where the work was or what it was. */
export function workHistoryEntryIsEmpty(entry: CodeItLabWorkHistoryEntry): boolean {
  return !filled(entry.company) && !filled(entry.role) && !filled(entry.summary);
}

export function profileWorkHistory(
  profile: CodeItLabProfileSettings,
): ReadonlyArray<CodeItLabWorkHistoryEntry> {
  return profile.workHistory.filter((entry) => !workHistoryEntryIsEmpty(entry));
}

/** True when a person would see an empty profile: nothing written yet. */
export function profileIsEmpty(profile: CodeItLabProfileSettings): boolean {
  return (
    !filled(profile.fullName) &&
    !filled(profile.headline) &&
    !filled(profile.location) &&
    !filled(profile.interestDomain) &&
    !filled(profile.skillset) &&
    profileWorkHistory(profile).length === 0
  );
}

/**
 * How far through the profile a person is, 0..1, as named steps. The home
 * screen shows this because a half-filled profile is the thing that stops a
 * business from writing back.
 */
export interface ProfileStep {
  readonly id: "identity" | "work" | "interests";
  readonly label: string;
  readonly done: boolean;
}

export function profileSteps(profile: CodeItLabProfileSettings): ReadonlyArray<ProfileStep> {
  return [
    {
      id: "identity",
      label: "Say who you are",
      done: filled(profile.fullName) && filled(profile.headline),
    },
    {
      id: "work",
      label: "Add the work you have done",
      done: profileWorkHistory(profile).length > 0,
    },
    {
      id: "interests",
      label: "Declare what interests you",
      done: filled(profile.interestDomain) || filled(profile.skillset),
    },
  ];
}

export function profileIsComplete(profile: CodeItLabProfileSettings): boolean {
  return profileSteps(profile).every((step) => step.done);
}

/**
 * A short block for a thread or bot brief. Labelled as user-declared context so
 * an agent does not treat it as an instruction, and omitted entirely when the
 * profile is empty.
 */
export function profileBrief(profile: CodeItLabProfileSettings): ReadonlyArray<string> {
  const lines: Array<string> = [];
  if (filled(profile.fullName)) {
    lines.push(`Name (declared by the user): ${profile.fullName.trim()}`);
  }
  if (filled(profile.headline)) {
    lines.push(`Headline (declared by the user): ${profile.headline.trim()}`);
  }
  if (filled(profile.location)) {
    lines.push(`Location (declared by the user): ${profile.location.trim()}`);
  }
  if (filled(profile.interestDomain)) {
    lines.push(`Interest domain (declared by the user): ${profile.interestDomain.trim()}`);
  }
  if (filled(profile.skillset)) {
    lines.push(`Skillset (declared by the user): ${profile.skillset.trim()}`);
  }
  const work = profileWorkHistory(profile);
  if (work.length > 0) {
    lines.push("Work history (declared by the user):");
    for (const entry of work) {
      const head = [entry.role.trim(), entry.company.trim()].filter(filled).join(" at ");
      const period = filled(entry.period) ? ` (${entry.period.trim()})` : "";
      const summary = filled(entry.summary) ? ` - ${entry.summary.trim()}` : "";
      lines.push(`- ${head}${period}${summary}`);
    }
  }
  return lines.length === 0 ? [] : ["", "Who this work is for:", ...lines];
}

/**
 * The profile as a person would read it on a page, one block per line. This is
 * what gets pasted into a marketplace introduction, so it carries no labels
 * aimed at an agent.
 */
export function profilePublicSummary(profile: CodeItLabProfileSettings): string {
  const blocks: Array<string> = [];
  const name = profile.fullName.trim();
  const headline = profile.headline.trim();
  const location = profile.location.trim();
  const opening = [name, headline].filter(filled).join(", ");
  if (filled(opening)) blocks.push(location === "" ? opening : `${opening} (${location})`);
  else if (filled(location)) blocks.push(location);
  const work = profileWorkHistory(profile);
  if (work.length > 0) {
    const rows = work.map((entry) => {
      const head = [entry.role.trim(), entry.company.trim()].filter(filled).join(" at ");
      const period = filled(entry.period) ? ` (${entry.period.trim()})` : "";
      const summary = filled(entry.summary) ? `: ${entry.summary.trim()}` : "";
      return `- ${head}${period}${summary}`;
    });
    blocks.push(["Work history:", ...rows].join("\n"));
  }
  const skillset = profile.skillset.trim();
  if (filled(skillset)) blocks.push(`Skills: ${skillset}`);
  const interest = profile.interestDomain.trim();
  if (filled(interest)) blocks.push(`Interested in: ${interest}`);
  return blocks.join("\n\n");
}

/** A profile with nothing filled in. Tests and new installs both start here. */
export function emptyProfile(): CodeItLabProfileSettings {
  return {
    fullName: "",
    headline: "",
    location: "",
    interestDomain: "",
    skillset: "",
    workHistory: [],
    visibleToBusinesses: false,
  };
}

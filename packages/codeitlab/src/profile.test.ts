import { describe, expect, it } from "vite-plus/test";

import {
  emptyProfile,
  profileBrief,
  profileIsComplete,
  profileIsEmpty,
  profilePublicSummary,
  profileSteps,
  profileWorkHistory,
} from "./profile.ts";

describe("profile", () => {
  it("is empty when nothing is filled in", () => {
    expect(profileIsEmpty(emptyProfile())).toBe(true);
    expect(profileIsEmpty({ ...emptyProfile(), interestDomain: "Agents" })).toBe(false);
    expect(profileIsEmpty({ ...emptyProfile(), fullName: "Maria" })).toBe(false);
  });

  it("does not let a blank work entry make the profile look filled in", () => {
    const profile = {
      ...emptyProfile(),
      workHistory: [{ company: "  ", role: "", period: "", summary: "" }],
    };
    expect(profileWorkHistory(profile)).toEqual([]);
    expect(profileIsEmpty(profile)).toBe(true);
  });

  it("produces no brief block for an empty profile", () => {
    expect(profileBrief(emptyProfile())).toEqual([]);
  });

  it("labels every field as user-declared and trims them", () => {
    const brief = profileBrief({
      ...emptyProfile(),
      fullName: "  Maria ",
      headline: " Backend engineer ",
      interestDomain: "  Local-first tools ",
      skillset: " TypeScript ",
    });
    expect(brief[0]).toBe("");
    expect(brief[1]).toBe("Who this work is for:");
    expect(brief).toContain("Name (declared by the user): Maria");
    expect(brief).toContain("Headline (declared by the user): Backend engineer");
    expect(brief).toContain("Interest domain (declared by the user): Local-first tools");
    expect(brief).toContain("Skillset (declared by the user): TypeScript");
    expect(brief.filter((line) => line === "Who this work is for:")).toHaveLength(1);
  });

  it("renders work history as one line per job", () => {
    const brief = profileBrief({
      ...emptyProfile(),
      workHistory: [{ company: "Acme", role: "Backend", period: "2021 - 2023", summary: "" }],
    });
    expect(brief).toContain("Work history (declared by the user):");
    expect(brief).toContain("- Backend at Acme (2021 - 2023)");
  });

  it("tracks the three steps the home screen shows", () => {
    expect(profileSteps(emptyProfile()).map((step) => step.done)).toEqual([false, false, false]);
    const partial = { ...emptyProfile(), fullName: "Maria", headline: "Backend engineer" };
    expect(profileSteps(partial).map((step) => step.done)).toEqual([true, false, false]);
    expect(profileIsComplete(partial)).toBe(false);

    const complete = {
      ...partial,
      interestDomain: "Infra",
      workHistory: [{ company: "Acme", role: "", period: "", summary: "" }],
    };
    expect(profileIsComplete(complete)).toBe(true);
  });

  it("reads as a page for a business, without agent-facing labels", () => {
    const summary = profilePublicSummary({
      ...emptyProfile(),
      fullName: "Maria",
      headline: "Backend engineer",
      location: "Athens",
      interestDomain: "Infra",
      skillset: "TypeScript",
      workHistory: [{ company: "Acme", role: "Backend", period: "2021 - 2023", summary: "APIs" }],
    });
    expect(summary).toContain("Maria, Backend engineer (Athens)");
    expect(summary).toContain("- Backend at Acme (2021 - 2023): APIs");
    expect(summary).toContain("Skills: TypeScript");
    expect(summary).toContain("Interested in: Infra");
    expect(summary).not.toContain("declared by the user");
  });

  it("summarises an empty profile as an empty string", () => {
    expect(profilePublicSummary(emptyProfile())).toBe("");
  });
});

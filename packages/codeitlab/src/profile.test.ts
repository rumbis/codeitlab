import { describe, expect, it } from "vite-plus/test";

import { profileBrief, profileIsEmpty } from "./profile.ts";

describe("profile", () => {
  it("is empty when both fields are blank or whitespace", () => {
    expect(profileIsEmpty({ interestDomain: "", skillset: "   " })).toBe(true);
    expect(profileIsEmpty({ interestDomain: "Agents", skillset: "" })).toBe(false);
  });

  it("produces no brief block for an empty profile", () => {
    expect(profileBrief({ interestDomain: "", skillset: "" })).toEqual([]);
  });

  it("labels both fields as user-declared and trims them", () => {
    const brief = profileBrief({
      interestDomain: "  Local-first tools ",
      skillset: " TypeScript ",
    });
    expect(brief[0]).toBe("");
    expect(brief[1]).toBe("Who this work is for:");
    expect(brief[2]).toBe("Interest domain (declared by the user): Local-first tools");
    expect(brief[3]).toBe("Skillset (declared by the user): TypeScript");
  });
});

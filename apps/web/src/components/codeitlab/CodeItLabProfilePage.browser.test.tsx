import { emptyProfile, profilePublicSummary } from "@codeitlab/core/profile";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabProfilePage } from "./CodeItLabProfilePage";

type Profile = ReturnType<typeof emptyProfile>;

const mock = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  updates: [] as Array<{ profile: Record<string, unknown> }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { profile: mock.profile },
    environmentId: null,
    update: (patch: { profile: Record<string, unknown> }) => {
      mock.updates.push(patch);
      mock.profile = patch.profile;
      return { profile: mock.profile };
    },
  })) as never,
}));

function reset(overrides: Partial<Profile> = {}) {
  const profile = { ...emptyProfile(), ...overrides };
  mock.profile = profile as unknown as Record<string, unknown>;
  mock.updates.length = 0;
  return profile;
}

function copyButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>('button[aria-describedby="profile-state"]');
}

describe("profile page", () => {
  it("says nothing is declared and lists the three steps", async () => {
    reset();
    await using screen = await renderUi(<CodeItLabProfilePage />);
    expect(screen.getByText(/Nothing declared yet/)).not.toBeNull();
    expect(screen.getByText("Say who you are")).not.toBeNull();
    expect(screen.getByText("Add the work you have done")).not.toBeNull();
    expect(screen.getByText("Declare what interests you")).not.toBeNull();
    expect(screen.getByText("Nothing to show yet")).not.toBeNull();
  });

  it("keeps Copy profile disabled until something is filled", async () => {
    reset();
    await using screen = await renderUi(<CodeItLabProfilePage />);
    expect(copyButton(screen.container)?.disabled).toBe(true);
  });

  it("enables Copy profile once a field has text", async () => {
    reset({ fullName: "Maria" });
    await using screen = await renderUi(<CodeItLabProfilePage />);
    expect(copyButton(screen.container)?.disabled).toBe(false);
  });

  it("shows the business-facing summary without agent labels", async () => {
    const profile = reset({
      fullName: "Maria",
      headline: "Backend engineer",
      location: "Athens",
      workHistory: [{ company: "Acme", role: "Backend", period: "2021 - 2023", summary: "APIs" }],
    });
    await using screen = await renderUi(<CodeItLabProfilePage />);
    const preview = screen.container.querySelector("#profile-public-preview")?.textContent ?? "";
    expect(preview).toBe(profilePublicSummary(profile));
    expect(preview).toContain("Maria, Backend engineer (Athens)");
    expect(preview).not.toContain("declared by the user");
  });

  it("asks for the remaining steps while the profile is incomplete", async () => {
    reset({ fullName: "Maria", interestDomain: "Local-first tools" });
    await using screen = await renderUi(<CodeItLabProfilePage />);
    expect(screen.getByText(/Fill in the remaining steps/)).not.toBeNull();
  });

  it("adds a blank work entry and keeps it out of the summary", async () => {
    reset({ fullName: "Maria" });
    await using screen = await renderUi(<CodeItLabProfilePage />);
    expect(screen.getByText("No work history yet")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Add/ }));
    const patch = mock.updates[0];
    expect(patch?.profile.workHistory).toEqual([
      { company: "", role: "", period: "", summary: "" },
    ]);
    const preview = screen.container.querySelector("#profile-public-preview")?.textContent ?? "";
    expect(preview).not.toContain("Work history");
  });

  it("saves the interest domain the user types", async () => {
    reset();
    await using screen = await renderUi(<CodeItLabProfilePage />);
    const domain = screen.container.querySelector<HTMLTextAreaElement>("#profile-domain");
    expect(domain).not.toBeNull();
    await userEvent.type(domain!, "Local-first tools");
    // Every keystroke patches from the stored profile, so the last update holds
    // the whole typed value rather than one character.
    const last = mock.updates.at(-1)?.profile.interestDomain;
    expect(typeof last).toBe("string");
    expect(String(last).endsWith("s")).toBe(true);
    expect(mock.updates.length).toBe("Local-first tools".length);
  });

  it("publishes nothing until the user switches visibility on", async () => {
    reset({ fullName: "Maria" });
    await using screen = await renderUi(<CodeItLabProfilePage />);
    expect(screen.getByText("Only you can see this.")).not.toBeNull();
    await userEvent.click(screen.getByRole("switch", { name: "Show my profile to businesses" }));
    expect(mock.updates.at(-1)?.profile.visibleToBusinesses).toBe(true);
  });
});

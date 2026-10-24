import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabProfilePage } from "./CodeitlabProfilePage";

const mock = vi.hoisted(() => ({
  profile: { interestDomain: "", skillset: "" },
  updates: [] as Array<{ profile: { interestDomain: string; skillset: string } }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { profile: mock.profile },
    environmentId: null,
    update: (patch: { profile: { interestDomain: string; skillset: string } }) => {
      mock.updates.push(patch);
      mock.profile = patch.profile;
      return { profile: mock.profile };
    },
  })) as never,
}));

describe("profile page", () => {
  it("says nothing is declared and shows no brief", async () => {
    mock.profile = { interestDomain: "", skillset: "" };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabProfilePage />);
    expect(screen.getByText(/Nothing declared yet/)).not.toBeNull();
    expect(screen.getByText("No brief context yet")).not.toBeNull();
  });

  it("saves the domain and previews the brief an agent would receive", async () => {
    mock.profile = { interestDomain: "", skillset: "" };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabProfilePage />);
    await userEvent.fill(
      screen.getByLabelText("Interest domain"),
      "Local-first tools for small studios",
    );
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    expect(mock.updates.at(-1)?.profile.interestDomain).toBe("Local-first tools for small studios");
    await vi.waitFor(() =>
      expect(
        screen.getByText(/Interest domain \(declared by the user\): Local-first tools/),
      ).not.toBeNull(),
    );
  });
});

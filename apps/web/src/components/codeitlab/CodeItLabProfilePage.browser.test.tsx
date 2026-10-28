import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabProfilePage } from "./CodeItLabProfilePage";

const mock = vi.hoisted(() => ({
  profile: { interestDomain: "", skillset: "" },
  updates: [] as Array<{ profile: { interestDomain: string; skillset: string } }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
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
    await using screen = await renderUi(<CodeItLabProfilePage />);
    expect(screen.getByText(/Nothing declared yet/)).not.toBeNull();
    expect(screen.getByText("No brief context yet")).not.toBeNull();
  });

  it("keeps Copy brief disabled until there is something to copy", async () => {
    mock.profile = { interestDomain: "", skillset: "" };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabProfilePage />);
    const copy = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-describedby="profile-brief-state"]',
    );
    expect(copy?.disabled).toBe(true);
    expect(screen.container.querySelector("#profile-brief-state")?.textContent).toContain(
      "Copy brief stays disabled until one has text",
    );
  });

  it("enables Copy brief once a field has text", async () => {
    mock.profile = { interestDomain: "", skillset: "TypeScript, Effect" };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabProfilePage />);
    const copy = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-describedby="profile-brief-state"]',
    );
    expect(copy?.disabled).toBe(false);
    expect(screen.container.querySelector("#profile-brief-state")?.textContent).toContain(
      "Saved on this machine",
    );
  });

  it("copies the exact brief an agent would receive", async () => {
    mock.profile = { interestDomain: "Local-first tools", skillset: "TypeScript" };
    mock.updates.length = 0;
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await using screen = await renderUi(<CodeItLabProfilePage />);
    const copy = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-describedby="profile-brief-state"]',
    );
    await userEvent.click(copy!);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Interest domain (declared by the user): Local-first tools");
    expect(text).toContain("Skillset (declared by the user): TypeScript");
    await vi.waitFor(() => expect(screen.getByText("Brief copied")).not.toBeNull());
  });

  it("saves the domain and previews the brief an agent would receive", async () => {
    mock.profile = { interestDomain: "", skillset: "" };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabProfilePage />);
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

import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { ComposerTeamsEntry } from "./ComposerTeamsEntry";

describe("composer teams entry", () => {
  it("opens the agent team setup", async () => {
    await using screen = await renderUi(<ComposerTeamsEntry />);
    await userEvent.click(screen.getByLabelText("Start an agent team"));
    await vi.waitFor(() =>
      expect(screen.router?.state.location.pathname).toBe("/settings/codeitlab/team"),
    );
  });
});

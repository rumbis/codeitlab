import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { CodeitlabSectionNav } from "./CodeitlabSectionNav";

describe("CodeitlabSectionNav", () => {
  it("moves focus with arrow keys and exposes a single tab stop", async () => {
    await using screen = await render(<CodeitlabSectionNav pathname="/settings/codeitlab" />, {
      router: "/settings/codeitlab",
    });

    const overview = screen.getByRole("link", { name: "Overview" });
    expect(overview.element().tabIndex).toBe(0);
    expect(screen.getByRole("link", { name: "Agents" }).element().tabIndex).toBe(-1);

    overview.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toContain("Agents");
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement?.textContent).toContain("Overview");
  });
});

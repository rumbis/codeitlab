import { expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render as renderUi } from "../../test/render";
import { CommandPaletteResults } from "./CommandPaletteResults";

const keybindings = {} as never;

it("leads somewhere when the palette finds nothing", async () => {
  await using screen = await renderUi(
    <CommandPaletteResults
      groups={[]}
      isActionsOnly={false}
      keybindings={keybindings}
      onExecuteItem={vi.fn()}
    />,
    { router: false }, // the empty state renders text only
  );

  const status = screen.getByRole("status");
  expect(status.element().textContent).toContain("No matching commands, projects, or threads.");
  expect(status.element().textContent).toContain("press Esc to close");
});

it("keeps an actions-only miss short and still says how to leave", async () => {
  await using screen = await renderUi(
    <CommandPaletteResults
      groups={[]}
      isActionsOnly
      keybindings={keybindings}
      onExecuteItem={vi.fn()}
    />,
    { router: false },
  );

  const status = screen.getByRole("status");
  expect(status.element().textContent).toContain("No matching actions.");
  expect(status.element().textContent).toContain("press Esc to close");
});

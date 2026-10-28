import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { SettingsSearchEmptyState } from "./SettingsSearchEmptyState";

it("names the query, says what search covers, and leads back to the sections", async () => {
  const onClear = vi.fn();
  await using screen = await renderUi(
    <SettingsSearchEmptyState query="  phosphor  " onClear={onClear} />,
    { router: false }, // the empty state has no links or navigation of its own
  );

  expect(screen.container.textContent).toContain("No setting matches “phosphor”.");
  expect(screen.container.textContent).toContain("not the text inside descriptions");

  const clear = screen.getByRole("button", { name: "Clear search and browse the sections" });
  clear.element().focus();
  await userEvent.keyboard("{Enter}");
  expect(onClear).toHaveBeenCalledTimes(1);
});

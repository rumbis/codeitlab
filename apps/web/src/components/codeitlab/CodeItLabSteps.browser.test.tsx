import "~/index.css";

import { describe, expect, it } from "vite-plus/test";
import { CodeItLabSteps } from "./CodeItLabPrimitives";
import { render } from "../../../test/render";

function markersOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("li > span[aria-hidden]")];
}

describe("CodeItLabSteps", () => {
  it("marks the first unfinished step as the one in progress", async () => {
    await using screen = await render(
      <CodeItLabSteps
        steps={[
          { id: "account", label: "Make an account", done: true },
          { id: "interest", label: "Declare what interests you", done: false },
          { id: "profile", label: "Add the work you have done", done: false },
        ]}
      />,
    );
    const markers = markersOf(screen.container);
    expect(markers.map((marker) => marker.textContent)).toEqual(["✓", "2", "3"]);
    // The states have to look different, or the marker is decoration. The class
    // list is the only way to assert colour without a screenshot.
    const [done, current, upcoming] = markers.map((marker) => marker.className);
    expect(done).toContain("border-success/50");
    expect(current).toContain("border-codeitlab-green");
    expect(upcoming).toContain("border-border");
    expect(new Set([done, current, upcoming]).size).toBe(3);
  });

  it("keeps the first step in progress when none are done", async () => {
    await using screen = await render(
      <CodeItLabSteps
        steps={[
          { id: "account", label: "Make an account", done: false },
          { id: "profile", label: "Add the work you have done", done: false },
        ]}
      />,
    );
    const markers = markersOf(screen.container);
    expect(markers.map((marker) => marker.textContent)).toEqual(["1", "2"]);
    expect(markers[0]?.className).toContain("border-codeitlab-green");
    expect(markers[1]?.className).toContain("border-border");
  });

  it("shows only ticks once everything is done", async () => {
    await using screen = await render(
      <CodeItLabSteps steps={[{ id: "account", label: "Make an account", done: true }]} />,
    );
    const markers = markersOf(screen.container);
    expect(markers.map((marker) => marker.textContent)).toEqual(["✓"]);
    expect(markers[0]?.className).toContain("border-success/50");
  });
});

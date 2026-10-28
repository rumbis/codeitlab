import { DEFAULT_CODEITLAB_SETTINGS, type CodeItLabEffectsSettings } from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabEffectsPage } from "./CodeItLabEffectsPage";

const mock = vi.hoisted(() => ({
  settings: null as CodeItLabEffectsSettings | null,
  updates: [] as Array<Partial<CodeItLabEffectsSettings>>,
  previews: [] as string[],
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabEffectsSettings: (() => mock.settings) as never,
  useCodeItLabEffectsWriter: (() => (patch: Partial<CodeItLabEffectsSettings>) => {
    mock.updates.push(patch);
    mock.settings = { ...mock.settings!, ...patch };
    return mock.settings;
  }) as never,
}));

vi.mock(import("../../codeitlab/audio"), async (original) => ({
  ...(await original()),
  previewCodeItLabSfx: ((name: string) => {
    mock.previews.push(name);
  }) as never,
  playCodeItLabSfx: (() => {}) as never,
  syncCodeItLabAmbient: (() => {}) as never,
  unlockCodeItLabAudio: (() => {}) as never,
}));

const previewButtons = (screen: { container: HTMLElement }) =>
  [...screen.container.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.textContent?.trim() === "Preview",
  );

describe("effects page", () => {
  it("disables Reset when everything is already at its default", async () => {
    mock.settings = { ...DEFAULT_CODEITLAB_SETTINGS.effects };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabEffectsPage />);
    const reset = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Reset",
    );
    expect(reset?.disabled).toBe(true);
    expect(reset?.getAttribute("aria-describedby")).toBe("effects-reset-state");
    expect(screen.container.querySelector("#effects-reset-state")?.textContent).toContain(
      "already at its default",
    );
  });

  it("offers Reset once a setting changed", async () => {
    mock.settings = { ...DEFAULT_CODEITLAB_SETTINGS.effects, threeD: "high" };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabEffectsPage />);
    const reset = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Reset",
    );
    expect(reset?.disabled).toBe(false);
    expect(screen.container.querySelector("#effects-reset-state")?.textContent).toContain(
      "Reset returns both effects to their defaults",
    );
    await userEvent.click(reset!);
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.threeD).toBe(DEFAULT_CODEITLAB_SETTINGS.effects.threeD);
  });

  it("keeps Preview disabled while sound is muted", async () => {
    mock.settings = { ...DEFAULT_CODEITLAB_SETTINGS.effects, sfxEnabled: false };
    mock.previews.length = 0;
    await using screen = await renderUi(<CodeItLabEffectsPage />);
    const previews = previewButtons(screen);
    expect(previews).toHaveLength(4);
    for (const preview of previews) {
      expect(preview.disabled).toBe(true);
      expect(preview.getAttribute("aria-describedby")).toBe("effects-sfx-state");
    }
    expect(screen.container.querySelector("#effects-sfx-state")?.textContent).toContain(
      "Sound is muted, so Preview is disabled",
    );
    // A disabled button cannot be clicked at all, so nothing reaches the audio layer.
    expect(mock.previews).toHaveLength(0);
  });

  it("previews an event once sound is on", async () => {
    mock.settings = { ...DEFAULT_CODEITLAB_SETTINGS.effects, sfxEnabled: true };
    mock.previews.length = 0;
    await using screen = await renderUi(<CodeItLabEffectsPage />);
    const previews = previewButtons(screen);
    expect(previews[0]?.disabled).toBe(false);
    expect(screen.container.querySelector("#effects-sfx-state")?.textContent).toContain(
      "Sound is on",
    );
    await userEvent.click(previews[0]!);
    await vi.waitFor(() => expect(mock.previews).toEqual(["click"]));
  });
});

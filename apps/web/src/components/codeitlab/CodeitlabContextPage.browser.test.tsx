import type { CodeitlabContextSettings } from "@codeitlab/core/context";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabContextPage } from "./CodeitlabContextPage";

const mock = vi.hoisted(() => ({
  context: { sizes: [] } as CodeitlabContextSettings,
  updates: [] as Array<{ context: CodeitlabContextSettings }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { context: mock.context },
    environmentId: null,
    update: (patch: { context: CodeitlabContextSettings }) => {
      mock.updates.push(patch);
      mock.context = patch.context;
      return { context: mock.context };
    },
  })) as never,
}));

const provider = {
  instanceId: "claude",
  driver: "claude",
  displayName: "Claude",
  enabled: true,
  installed: true,
  status: "ready",
  availability: "available",
  models: [
    { slug: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", isCustom: false, capabilities: null },
  ],
};

vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: (() => "env-1") as never,
  useEnvironmentProviders: (() => new Map([["env-1", [provider]]])) as never,
}));

describe("context page", () => {
  it("shows the estimate in effect before anything is recorded", async () => {
    mock.context = { sizes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabContextPage />);
    expect(screen.getByText("~200k")).not.toBeNull();
    expect(screen.getByText("Claude Sonnet 4.5")).not.toBeNull();
  });

  it("records a size per model and shows it as measured", async () => {
    mock.context = { sizes: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabContextPage />);
    const input = screen.getByLabelText("Recorded context size for Claude Sonnet 4.5");
    await userEvent.type(input, "1000000");
    await userEvent.click(screen.getByText("Model"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.context.sizes).toEqual([
      { instanceId: "claude", model: "claude-sonnet-4-5", tokens: 1_000_000 },
    ]);
    await vi.waitFor(() => expect(screen.getByText("1M")).not.toBeNull());
  });

  it("clearing the input removes the recorded value", async () => {
    mock.context = {
      sizes: [{ instanceId: "claude", model: "claude-sonnet-4-5", tokens: 500_000 }],
    };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabContextPage />);
    const input = screen.getByLabelText("Recorded context size for Claude Sonnet 4.5");
    await userEvent.clear(input);
    await userEvent.click(screen.getByText("Model"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.context.sizes).toEqual([]);
  });
});

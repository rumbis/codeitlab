import type { CodeitlabDeploySettings } from "@codeitlab/core/deploy";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabDeployPage } from "./CodeitlabDeployPage";

const mock = vi.hoisted(() => ({
  deploy: { targets: [] } as CodeitlabDeploySettings,
  updates: [] as Array<{ deploy: CodeitlabDeploySettings }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { deploy: mock.deploy },
    environmentId: null,
    update: (patch: { deploy: CodeitlabDeploySettings }) => {
      mock.updates.push(patch);
      mock.deploy = patch.deploy;
      return { deploy: mock.deploy };
    },
  })) as never,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => []) as never,
  useThreadShells: (() => []) as never,
}));

vi.mock(import("../../hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => async () => null) as never,
}));

describe("deploy page", () => {
  it("starts from the empty state with a new target", async () => {
    mock.deploy = { targets: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabDeployPage />);
    expect(screen.getByText("No deploy targets yet")).not.toBeNull();
    await userEvent.click(screen.getByText("New target"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.deploy.targets).toHaveLength(1);
  });

  it("adds a starter target with its command filled in", async () => {
    mock.deploy = { targets: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabDeployPage />);
    await userEvent.click(screen.getByText("Vercel"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    const target = mock.updates[0]?.deploy.targets[0];
    expect(target?.name).toBe("Vercel");
    expect(target?.command).toBe("vercel deploy --prod");
  });

  it("refuses to run without a project and says why", async () => {
    mock.deploy = {
      targets: [
        {
          id: "deploy-1",
          name: "Vercel",
          command: "vercel deploy --prod",
          notes: "",
          enabled: true,
        },
      ],
    };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabDeployPage />);
    await userEvent.click(screen.getByText("Run deploy"));
    await vi.waitFor(() => expect(screen.getByText("Open a project first")).not.toBeNull());
    expect(mock.updates).toHaveLength(0);
  });

  it("runs the deploy action from the keyboard", async () => {
    mock.deploy = {
      targets: [
        {
          id: "deploy-1",
          name: "Vercel",
          command: "vercel deploy --prod",
          notes: "",
          enabled: true,
        },
      ],
    };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabDeployPage />);
    const run = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Run deploy",
    );
    expect(run?.type).toBe("button");
    run?.focus();
    expect(document.activeElement).toBe(run);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(screen.getByText("Open a project first")).not.toBeNull());
    expect(mock.updates).toHaveLength(0);
  });
});

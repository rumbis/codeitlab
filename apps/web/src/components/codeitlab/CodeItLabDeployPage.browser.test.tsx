import type { CodeItLabDeploySettings } from "@codeitlab/core/deploy";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabDeployPage } from "./CodeItLabDeployPage";

const mock = vi.hoisted(() => ({
  deploy: { targets: [] } as CodeItLabDeploySettings,
  updates: [] as Array<{ deploy: CodeItLabDeploySettings }>,
  projects: [] as ReadonlyArray<Record<string, unknown>>,
  shells: [] as ReadonlyArray<Record<string, unknown>>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { deploy: mock.deploy },
    environmentId: null,
    update: (patch: { deploy: CodeItLabDeploySettings }) => {
      mock.updates.push(patch);
      mock.deploy = patch.deploy;
      return { deploy: mock.deploy };
    },
  })) as never,
}));

vi.mock(import("../../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => mock.projects) as never,
  useThreadShells: (() => mock.shells) as never,
}));

vi.mock(import("../../hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => async () => null) as never,
}));

describe("deploy page", () => {
  it("starts from the empty state with a new target", async () => {
    mock.deploy = { targets: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabDeployPage />);
    expect(screen.getByText("No deploy targets yet")).not.toBeNull();
    await userEvent.click(screen.getByText("New target"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.deploy.targets).toHaveLength(1);
  });

  it("adds a starter target with its command filled in", async () => {
    mock.deploy = { targets: [] };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabDeployPage />);
    await userEvent.click(screen.getByText("Vercel"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    const target = mock.updates[0]?.deploy.targets[0];
    expect(target?.name).toBe("Vercel");
    expect(target?.command).toBe("vercel deploy --prod");
  });

  it("keeps Run deploy disabled without a project and says why", async () => {
    mock.projects = [];
    mock.shells = [];
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
    await using screen = await renderUi(<CodeItLabDeployPage />);
    const run = [...screen.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Run deploy",
    );
    expect(run?.disabled).toBe(true);
    expect(run?.getAttribute("aria-describedby")).toBe("deploy-issue-deploy-1");
    expect(screen.container.querySelector("#deploy-issue-deploy-1")?.textContent).toContain(
      "Open a project first",
    );
    expect(mock.updates).toHaveLength(0);
  });

  it("runs the deploy action from the keyboard", async () => {
    mock.projects = [
      {
        id: "project-1",
        environmentId: "local",
        isScratch: false,
        name: "App",
        updatedAt: "2026-10-24T12:00:00.000Z",
      },
    ];
    mock.shells = [];
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
    await using screen = await renderUi(<CodeItLabDeployPage />);
    const run = [...screen.container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Run deploy",
    );
    expect(run?.type).toBe("button");
    run?.focus();
    expect(document.activeElement).toBe(run);
    await userEvent.keyboard("{Enter}");
    // The mocked thread handler returns null, so the keyboard path still reports
    // that nothing was opened rather than silently doing nothing.
    await vi.waitFor(() => expect(screen.getByText("Could not open a thread")).not.toBeNull());
    expect(mock.updates).toHaveLength(0);
  });

  it("ties the target issue to the command field for screen readers", async () => {
    mock.deploy = {
      targets: [
        { id: "deploy-1", name: "  ", command: "vercel deploy --prod", notes: "", enabled: true },
      ],
    };
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabDeployPage />);
    const command = screen.container.querySelector("#deploy-command-deploy-1");
    expect(command?.getAttribute("aria-describedby")).toBe("deploy-issue-deploy-1");
    const issue = screen.container.querySelector("#deploy-issue-deploy-1");
    expect(issue?.getAttribute("aria-live")).toBe("polite");
    expect(issue?.textContent).toContain("Give the target a name");
    const run = [...screen.container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Run deploy"),
    );
    expect(run?.disabled).toBe(true);
  });

  it("leaves a valid target without a dangling description", async () => {
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
    await using screen = await renderUi(<CodeItLabDeployPage />);
    const command = screen.container.querySelector("#deploy-command-deploy-1");
    expect(command?.getAttribute("aria-describedby")).toBeNull();
    expect(screen.container.querySelector("#deploy-issue-deploy-1")).toBeNull();
  });
});

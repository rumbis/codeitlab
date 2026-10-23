import type {
  CodeitlabCredentialsScanResult,
  CodeitlabCredentialsSettings,
  CodeitlabCredentialsStatus,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabCredentialsPage } from "./CodeitlabCredentialsPage";

const SCAN_RESULT: CodeitlabCredentialsScanResult = {
  masked: "my key is sk-proj-XXXX",
  findings: [
    { kind: "api-key", source: "pattern", start: 10, end: 30 },
    { kind: "private-block", source: "tag", start: 31, end: 40 },
  ],
  blocked: false,
  privateBlocks: 1,
  modelUsed: true,
};

const STATUS: CodeitlabCredentialsStatus = {
  enabled: false,
  running: false,
  port: 5284,
  gatewayUrl: "http://127.0.0.1:5284/v1",
  mode: "balanced",
  privateTag: "mask",
  model: {
    id: "codeitlab-tiny-credentials",
    label: "Codeitlab Tiny Credentials",
    version: "1.0.0",
    sizeBytes: 8233,
    state: "bundled",
  },
  scanned: 3,
  maskedValues: 5,
  blocked: 1,
  audit: [
    {
      id: "cred_1",
      at: "2026-10-23T06:00:00.000Z",
      target: "prompt",
      findings: 2,
      kinds: ["api-key", "password"],
      blocked: false,
    },
  ],
};

const mock = vi.hoisted(() => ({
  credentials: null as unknown,
  settings: null as unknown,
  updates: [] as CodeitlabCredentialsSettings[],
  scans: [] as Array<{ text: string }>,
  starts: 0,
}));

vi.mock(import("../../codeitlab/api"), async (original) => ({
  ...(await original()),
  useCodeitlabCredentials: (() => mock.credentials) as never,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: mock.settings,
    environmentId: null,
    update: () => mock.settings,
  })) as never,
}));

function setup(): void {
  mock.updates.length = 0;
  mock.scans.length = 0;
  mock.starts = 0;
  const settings = {
    enabled: false,
    mode: "balanced",
    gatewayPort: 5284,
    privateTag: "mask",
    maskPersonalData: true,
    restoreResponses: true,
    blockOnModelFlag: false,
    modelId: "codeitlab-tiny-credentials",
    reviewerUrl: "",
    reviewerModel: "",
    auditLimit: 500,
  };
  mock.settings = { credentials: settings };
  mock.credentials = {
    data: STATUS,
    source: "server",
    error: null,
    isPending: false,
    refresh: () => {},
    update: async (next: CodeitlabCredentialsSettings) => {
      mock.updates.push(next);
      return { ...STATUS, enabled: next.enabled };
    },
    scan: async (input: { text: string }) => {
      mock.scans.push(input);
      return SCAN_RESULT;
    },
    restore: async () => ({ text: "", restored: 0 }),
    start: async () => {
      mock.starts += 1;
      return { ...STATUS, running: true };
    },
    stop: async () => ({ ...STATUS, running: false }),
    downloadModel: async () => STATUS.model,
  };
}

describe("CodeitlabCredentialsPage", () => {
  it("renders the firewall state, model and value-free audit", async () => {
    setup();
    await using screen = await renderUi(<CodeitlabCredentialsPage />);
    expect(screen.getByText("Credentials proxy")).not.toBeNull();
    expect(screen.getByText(/Codeitlab Tiny Credentials/)).not.toBeNull();
    expect(screen.container.querySelector("[data-credentials-audit]")?.textContent).toContain(
      "prompt",
    );
    expect(screen.container.querySelector("[data-credentials-audit]")?.textContent).not.toContain(
      "sk-proj",
    );
  });

  it("saves the enabled switch through the update RPC", async () => {
    setup();
    await using screen = await renderUi(<CodeitlabCredentialsPage />);
    const toggle = screen.container.querySelector<HTMLElement>(
      '[data-credentials-switch] [role="switch"]',
    );
    expect(toggle).not.toBeNull();
    await userEvent.click(toggle!);
    await userEvent.click(screen.getByText("Save settings"));
    await vi.waitFor(() => expect(mock.updates).toHaveLength(1));
    expect(mock.updates[0]?.enabled).toBe(true);
  });

  it("scans the preview locally and shows the masked result", async () => {
    setup();
    await using screen = await renderUi(<CodeitlabCredentialsPage />);
    const textarea = screen.container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    await userEvent.click(screen.getByText("Scan locally"));
    await vi.waitFor(() => expect(mock.scans).toHaveLength(1));
    expect(mock.scans[0]?.text).toContain("sk-proj-");
    await vi.waitFor(() => expect(screen.getByText("my key is sk-proj-XXXX")).not.toBeNull());
    expect(screen.getByText("API key")).not.toBeNull();
  });

  it("starts the local gateway from the gateway card", async () => {
    setup();
    await using screen = await renderUi(<CodeitlabCredentialsPage />);
    await userEvent.click(screen.getByText("Start"));
    await vi.waitFor(() => expect(mock.starts).toBe(1));
  });
});

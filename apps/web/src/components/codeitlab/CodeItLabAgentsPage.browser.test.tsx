import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import type {
  FreemiumAgentCard,
  PremiumAgentCard,
  RegistryAgentCard,
} from "../../codeitlab/agents";
import type { AgentHealth } from "../../codeitlab/agents.logic";
import { CodeItLabAgentsPage } from "./CodeItLabAgentsPage";

const CARD: FreemiumAgentCard = {
  id: "gemini",
  name: "Gemini CLI",
  summary: "Google's terminal agent, ACP-ready.",
  freeNote: "Free tier: 1,000 requests/day with a Google account.",
  kind: "free-tier",
  tier: "freemium",
  docsUrl: "https://geminicli.com/docs/resources/quota-and-pricing",
  version: "1.2.3",
  icon: null,
  installed: false,
  instanceId: null,
  installing: false,
  health: null,
  healthMessage: null,
};

const OTHER_CARD: RegistryAgentCard = {
  id: "dimcode",
  name: "DimCode",
  summary: "Proprietary DimAgent with BYO model providers.",
  version: "0.9.1",
  icon: null,
  docsUrl: "https://www.dimcode.dev/",
  installed: false,
  instanceId: null,
  installing: false,
  health: null,
  healthMessage: null,
};

const PREMIUM_CARD: PremiumAgentCard = {
  id: "minimax-code",
  name: "MiniMax Code",
  summary: "MiniMax's coding agent.",
  premiumNote:
    "Requires a MiniMax account/plan; not available in Cyprus (EU), kept as an option for other regions.",
  tier: "premium",
  docsUrl: "https://www.minimax.io/",
  availability: {
    blockedCountries: ["CY"],
    note: "MiniMax does not serve Cyprus; keep it as an option for other regions. UNVERIFIED — user-reported failure, pending research.",
  },
  version: "0.2.7",
  icon: null,
  installed: false,
  instanceId: null,
  installing: false,
  health: null,
  healthMessage: null,
};

const INSTALLED_CARD: FreemiumAgentCard = {
  ...CARD,
  id: "goose",
  name: "goose",
  kind: "open-source",
  installed: true,
  instanceId: "acpRegistry_goose",
};

const mock = vi.hoisted(() => ({
  view: null as unknown,
  installs: [] as string[],
  refreshes: 0,
  disabled: 0,
}));

vi.mock(import("../../codeitlab/audio"), async (original) => ({
  ...(await original()),
  playCodeItLabSfx: (() => {}) as never,
  unlockCodeItLabAudio: (() => {}) as never,
}));

vi.mock(import("../../codeitlab/agents"), async (original) => ({
  ...(await original()),
  useCodeItLabAgents: (() => mock.view) as never,
}));

function setup(
  options: {
    readonly installed?: boolean;
    readonly canInstall?: boolean;
    readonly installFails?: boolean;
    readonly source?: "server" | "local";
    readonly error?: string | null;
    readonly otherAgents?: ReadonlyArray<RegistryAgentCard>;
    readonly premiumAgents?: ReadonlyArray<PremiumAgentCard>;
    readonly health?: AgentHealth;
    readonly healthMessage?: string;
    readonly premiumInstanceCount?: number;
    readonly pending?: boolean;
  } = {},
): void {
  mock.installs.length = 0;
  mock.refreshes = 0;
  mock.disabled = 0;
  const cards =
    options.installed === true
      ? [
          {
            ...INSTALLED_CARD,
            health: options.health ?? null,
            healthMessage: options.healthMessage ?? null,
          },
        ]
      : [CARD];
  mock.view = {
    agents: cards,
    premiumAgents: options.premiumAgents ?? [],
    otherAgents: options.otherAgents ?? [],
    premiumInstanceCount: options.premiumInstanceCount ?? 0,
    installedCount: cards.filter((card) => card.installed).length,
    canInstall: options.canInstall ?? true,
    source: options.source ?? "server",
    error: options.error ?? null,
    isPending: options.pending ?? false,
    refresh: () => {
      mock.refreshes += 1;
    },
    disablePremiumAgents: async () => {
      mock.disabled += 1;
      return { ok: true, disabled: options.premiumInstanceCount ?? 0 };
    },
    install: async (agentId: string) => {
      mock.installs.push(agentId);
      return options.installFails === true
        ? { ok: false, message: "npm install failed: network unreachable" }
        : { ok: true };
    },
  };
}

describe("CodeItLabAgentsPage", () => {
  it("announces the loading state before the list arrives", async () => {
    setup({ pending: true, source: "local" });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    const status = screen.container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Loading agents");
    expect(status?.getAttribute("aria-busy")).toBe("true");
  });

  it("hides premium agents and the unverified registry until asked", async () => {
    setup({ premiumAgents: [PREMIUM_CARD], otherAgents: [OTHER_CARD], premiumInstanceCount: 2 });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    expect(screen.getByText("Only agents with a free model or free tier are shown")).toBeDefined();
    await expect.element(screen.getByText("MiniMax Code")).not.toBeInTheDocument();
    await expect.element(screen.getByText("DimCode")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /^premium \(1\)$/i }))
      .not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /^disable premium providers \(2\)$/i }),
    );
    await expect.element(screen.getByText(/only free agents are available now/i)).toBeVisible();
    expect(mock.disabled).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: /^show premium agents$/i }));
    await expect.element(screen.getByText("DimCode")).toBeVisible();
  });

  it("renders the free note and installs an agent on click", async () => {
    setup();
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    expect(screen.getByText("Gemini CLI")).toBeDefined();
    expect(screen.getByText("Free tier: 1,000 requests/day with a Google account.")).toBeDefined();
    expect(screen.getByText("Free tier")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(mock.installs).toEqual(["gemini"]);
    expect(screen.container.querySelector("[data-agents-error]")).toBeNull();
    await expect.element(screen.getByText("Installed", { exact: true })).toBeVisible();
  });

  it("moves between the tier filters with arrow keys from one tab stop", async () => {
    setup({ premiumAgents: [PREMIUM_CARD] });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await userEvent.click(screen.getByRole("button", { name: /^show premium agents$/i }));
    const freemium = screen.getByRole("button", { name: /^freemium \(1\)$/i }).element();
    const premium = screen.getByRole("button", { name: /^premium \(1\)$/i }).element();
    expect(freemium.tabIndex).toBe(0);
    expect(premium.tabIndex).toBe(-1);
    freemium.focus();
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(document.activeElement).toBe(premium));
    expect(premium.tabIndex).toBe(0);
    expect(freemium.tabIndex).toBe(-1);
    await expect.element(screen.getByText("MiniMax Code")).toBeVisible();
  });

  it("switches between the freemium and premium tabs with counts", async () => {
    setup({ premiumAgents: [PREMIUM_CARD] });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await userEvent.click(screen.getByRole("button", { name: /^show premium agents$/i }));
    expect(screen.getByRole("button", { name: /^freemium \(1\)$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^premium \(1\)$/i })).toBeDefined();
    expect(screen.getByText("Gemini CLI")).toBeDefined();
    await expect.element(screen.getByText("MiniMax Code")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^premium \(1\)$/i }));
    await expect.element(screen.getByText("MiniMax Code")).toBeVisible();
    expect(screen.getByText(/not available in cyprus/i)).toBeDefined();
    await expect.element(screen.getByText("Gemini CLI")).not.toBeInTheDocument();
  });

  it("flags an agent that is not available in the user's region", async () => {
    using _language = vi.spyOn(navigator, "language", "get").mockReturnValue("en-CY");
    setup({ premiumAgents: [PREMIUM_CARD] });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await userEvent.click(screen.getByRole("button", { name: /^show premium agents$/i }));
    await expect.element(screen.getByText("Region: CY")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /^premium \(1\)$/i }));
    await expect.element(screen.getByText("Not available in your region")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: /^install$/i })).toBeEnabled();
  });

  it("hides known-unavailable agents when the region filter is on", async () => {
    using _language = vi.spyOn(navigator, "language", "get").mockReturnValue("en-CY");
    setup({ premiumAgents: [PREMIUM_CARD] });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await userEvent.click(screen.getByRole("button", { name: /^show premium agents$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^premium \(1\)$/i }));
    await expect.element(screen.getByText("MiniMax Code")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /^available in my region$/i }));
    await expect.element(screen.getByText("MiniMax Code")).not.toBeInTheDocument();
  });

  it("shows the failure reason when an install fails", async () => {
    setup({ installFails: true });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await userEvent.click(screen.getByRole("button", { name: /^install$/i }));
    await expect.element(screen.getByText("npm install failed: network unreachable")).toBeVisible();
  });

  it("shows an installed agent with a manage link instead of an install button", async () => {
    setup({ installed: true });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    const card = screen.container.querySelector('[data-agent-id="goose"]');
    expect(card?.getAttribute("data-agent-installed")).toBe("true");
    expect(screen.getByText("Installed")).toBeDefined();
    await expect.element(screen.getByRole("link", { name: /manage/i })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /^install$/i }))
      .not.toBeInTheDocument();
  });

  it("disables installs when the environment does not allow provider changes", async () => {
    setup({ canInstall: false });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await expect.element(screen.getByRole("button", { name: /^install$/i })).toBeDisabled();
    // The disabled button names the sentence that explains it.
    const install = screen.container.querySelector<HTMLButtonElement>("[data-agent-install]");
    expect(install?.getAttribute("aria-describedby")).toBe("agents-connect-environment");
    const reason = screen.container.querySelector("#agents-connect-environment");
    expect(reason?.textContent).toContain("does not allow provider changes");
  });

  it("explains a local install block as a missing environment", async () => {
    setup({ canInstall: false, source: "local" });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    const install = screen.container.querySelector<HTMLButtonElement>("[data-agent-install]");
    expect(install?.getAttribute("aria-describedby")).toBe("agents-connect-environment");
    const reason = screen.container.querySelector("#agents-connect-environment");
    expect(reason?.textContent).toContain("Installs run on a connected computer");
  });

  it("leaves the install button without a reason when installs are allowed", async () => {
    setup();
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    const install = screen.container.querySelector<HTMLButtonElement>("[data-agent-install]");
    expect(install?.getAttribute("aria-describedby")).toBeNull();
  });

  it("shows the provider health after install and links to sign-in", async () => {
    setup({ installed: true, health: "sign-in", healthMessage: "Sign in to finish setup" });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await expect.element(screen.getByText("Sign in needed")).toBeVisible();
    const signIn = screen.getByRole("link", { name: /^sign in$/i });
    expect(signIn.element().getAttribute("href")).toContain("instanceId=acpRegistry_goose");
  });

  it("installs an agent from the rest of the registry too", async () => {
    setup({ otherAgents: [OTHER_CARD] });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await userEvent.click(screen.getByRole("button", { name: /^show premium agents$/i }));
    expect(screen.getByText("More ACP agents")).toBeDefined();
    const installButton = screen.container.querySelector(
      '[data-agent-id="dimcode"] [data-agent-install]',
    );
    expect(installButton).not.toBeNull();
    await userEvent.click(installButton as Element);
    expect(mock.installs).toEqual(["dimcode"]);
  });

  it("explains that installs need a connected environment", async () => {
    setup({ canInstall: false, source: "local" });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    await expect.element(screen.getByText("Connect an environment")).toBeVisible();
  });

  it("warns when the registry is unreachable", async () => {
    setup({ source: "local", error: "registry request failed" });
    await using screen = await renderUi(<CodeItLabAgentsPage />);
    expect(screen.getByText(/registry could not be reached/i)).toBeDefined();
    expect(screen.getByText(/registry request failed/)).toBeDefined();
  });
});

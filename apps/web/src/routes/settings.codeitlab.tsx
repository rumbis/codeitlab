import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabPanelShell } from "../components/codeitlab/CodeItLabPanelShell";

export const Route = createFileRoute("/settings/codeitlab")({
  component: CodeItLabPanelShell,
});

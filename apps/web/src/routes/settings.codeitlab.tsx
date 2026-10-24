import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabPanelShell } from "../components/codeitlab/CodeitlabPanelShell";

export const Route = createFileRoute("/settings/codeitlab")({
  component: CodeitlabPanelShell,
});

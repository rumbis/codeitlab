import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabAgentsPage } from "../components/codeitlab/CodeItLabAgentsPage";

export const Route = createFileRoute("/settings/codeitlab/agents")({
  component: CodeItLabAgentsPage,
});

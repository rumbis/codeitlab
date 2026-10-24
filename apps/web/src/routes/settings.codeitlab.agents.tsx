import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabAgentsPage } from "../components/codeitlab/CodeitlabAgentsPage";

export const Route = createFileRoute("/settings/codeitlab/agents")({
  component: CodeitlabAgentsPage,
});

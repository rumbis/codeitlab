import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabBotsPage } from "../components/codeitlab/CodeitlabBotsPage";

export const Route = createFileRoute("/settings/codeitlab/bots")({
  component: CodeitlabBotsPage,
});

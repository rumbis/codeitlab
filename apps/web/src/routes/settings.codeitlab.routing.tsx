import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabRoutingPage } from "../components/codeitlab/CodeitlabRoutingPage";

export const Route = createFileRoute("/settings/codeitlab/routing")({
  component: CodeitlabRoutingPage,
});

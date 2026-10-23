import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabOverviewPage } from "../components/codeitlab/CodeitlabOverviewPage";

export const Route = createFileRoute("/settings/codeitlab/")({
  component: CodeitlabOverviewPage,
});

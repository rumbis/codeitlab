import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabIssuesPage } from "../components/codeitlab/CodeitlabIssuesPage";

export const Route = createFileRoute("/settings/codeitlab/issues")({
  component: CodeitlabIssuesPage,
});

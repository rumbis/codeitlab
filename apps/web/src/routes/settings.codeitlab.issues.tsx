import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabIssuesPage } from "../components/codeitlab/CodeItLabIssuesPage";

export const Route = createFileRoute("/settings/codeitlab/issues")({
  component: CodeItLabIssuesPage,
});

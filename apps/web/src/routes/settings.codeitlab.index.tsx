import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabOverviewPage } from "../components/codeitlab/CodeItLabOverviewPage";

export const Route = createFileRoute("/settings/codeitlab/")({
  component: CodeItLabOverviewPage,
});

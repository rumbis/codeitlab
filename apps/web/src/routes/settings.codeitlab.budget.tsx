import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabBudgetPage } from "../components/codeitlab/CodeitlabBudgetPage";

export const Route = createFileRoute("/settings/codeitlab/budget")({
  component: CodeitlabBudgetPage,
});

import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabBudgetPage } from "../components/codeitlab/CodeItLabBudgetPage";

export const Route = createFileRoute("/settings/codeitlab/budget")({
  component: CodeItLabBudgetPage,
});

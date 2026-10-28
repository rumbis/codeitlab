import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabEcosystemPage } from "../components/codeitlab/CodeItLabEcosystemPage";

export const Route = createFileRoute("/settings/codeitlab/ecosystem")({
  component: CodeItLabEcosystemPage,
});

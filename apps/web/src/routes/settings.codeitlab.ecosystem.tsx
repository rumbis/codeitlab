import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabEcosystemPage } from "../components/codeitlab/CodeitlabEcosystemPage";

export const Route = createFileRoute("/settings/codeitlab/ecosystem")({
  component: CodeitlabEcosystemPage,
});

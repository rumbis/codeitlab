import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabDeployPage } from "../components/codeitlab/CodeitlabDeployPage";

export const Route = createFileRoute("/settings/codeitlab/deploy")({
  component: CodeitlabDeployPage,
});

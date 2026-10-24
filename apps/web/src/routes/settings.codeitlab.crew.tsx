import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabIntegrationPage } from "../components/codeitlab/CodeitlabIntegrationPage";

export const Route = createFileRoute("/settings/codeitlab/crew")({
  component: () => <CodeitlabIntegrationPage id="crew" />,
});

import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabIntegrationPage } from "../components/codeitlab/CodeItLabIntegrationPage";

export const Route = createFileRoute("/settings/codeitlab/crew")({
  component: () => <CodeItLabIntegrationPage id="crew" />,
});

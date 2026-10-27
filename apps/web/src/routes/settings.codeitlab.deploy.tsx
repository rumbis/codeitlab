import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabDeployPage } from "../components/codeitlab/CodeItLabDeployPage";

export const Route = createFileRoute("/settings/codeitlab/deploy")({
  component: CodeItLabDeployPage,
});

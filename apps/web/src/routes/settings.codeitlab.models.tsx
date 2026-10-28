import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabModelsPage } from "../components/codeitlab/CodeItLabModelsPage";

export const Route = createFileRoute("/settings/codeitlab/models")({
  component: CodeItLabModelsPage,
});

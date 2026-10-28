import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabNexusPage } from "../components/codeitlab/CodeItLabNexusPage";

export const Route = createFileRoute("/settings/codeitlab/nexus")({
  component: CodeItLabNexusPage,
});

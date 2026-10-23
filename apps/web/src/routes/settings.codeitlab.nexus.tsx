import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabNexusPage } from "../components/codeitlab/CodeitlabNexusPage";

export const Route = createFileRoute("/settings/codeitlab/nexus")({
  component: CodeitlabNexusPage,
});

import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabReaPage } from "../components/codeitlab/CodeitlabReaPage";

export const Route = createFileRoute("/settings/codeitlab/rea")({
  component: CodeitlabReaPage,
});

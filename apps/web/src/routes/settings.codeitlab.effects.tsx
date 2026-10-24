import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabEffectsPage } from "../components/codeitlab/CodeitlabEffectsPage";

export const Route = createFileRoute("/settings/codeitlab/effects")({
  component: CodeitlabEffectsPage,
});

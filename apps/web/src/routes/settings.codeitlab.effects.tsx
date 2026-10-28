import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabEffectsPage } from "../components/codeitlab/CodeItLabEffectsPage";

export const Route = createFileRoute("/settings/codeitlab/effects")({
  component: CodeItLabEffectsPage,
});

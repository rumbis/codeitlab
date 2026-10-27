import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabTeamPage } from "../components/codeitlab/CodeItLabTeamPage";

export const Route = createFileRoute("/settings/codeitlab/team")({
  component: CodeItLabTeamPage,
});

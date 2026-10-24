import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabTeamPage } from "../components/codeitlab/CodeitlabTeamPage";

export const Route = createFileRoute("/settings/codeitlab/team")({
  component: CodeitlabTeamPage,
});

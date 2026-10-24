import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabBoardPage } from "../components/codeitlab/CodeitlabBoardPage";

export const Route = createFileRoute("/settings/codeitlab/board")({
  component: CodeitlabBoardPage,
});

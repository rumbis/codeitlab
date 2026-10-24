import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabMoodBoardPage } from "../components/codeitlab/CodeitlabMoodBoardPage";

export const Route = createFileRoute("/settings/codeitlab/mood")({
  component: CodeitlabMoodBoardPage,
});

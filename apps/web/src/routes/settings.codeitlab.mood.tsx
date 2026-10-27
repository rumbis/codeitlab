import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabMoodBoardPage } from "../components/codeitlab/CodeItLabMoodBoardPage";

export const Route = createFileRoute("/settings/codeitlab/mood")({
  component: CodeItLabMoodBoardPage,
});

import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabBoardPage } from "../components/codeitlab/CodeItLabBoardPage";

export const Route = createFileRoute("/settings/codeitlab/board")({
  component: CodeItLabBoardPage,
});

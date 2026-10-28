import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabBotsPage } from "../components/codeitlab/CodeItLabBotsPage";

export const Route = createFileRoute("/settings/codeitlab/bots")({
  component: CodeItLabBotsPage,
});

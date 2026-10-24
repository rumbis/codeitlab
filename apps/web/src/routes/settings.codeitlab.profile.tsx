import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabProfilePage } from "../components/codeitlab/CodeitlabProfilePage";

export const Route = createFileRoute("/settings/codeitlab/profile")({
  component: CodeitlabProfilePage,
});

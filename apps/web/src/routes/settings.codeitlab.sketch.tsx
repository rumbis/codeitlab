import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabSketchPage } from "../components/codeitlab/CodeitlabSketchPage";

export const Route = createFileRoute("/settings/codeitlab/sketch")({
  component: CodeitlabSketchPage,
});

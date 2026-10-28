import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabSketchPage } from "../components/codeitlab/CodeItLabSketchPage";

export const Route = createFileRoute("/settings/codeitlab/sketch")({
  component: CodeItLabSketchPage,
});

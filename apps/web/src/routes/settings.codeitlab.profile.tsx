import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabProfilePage } from "../components/codeitlab/CodeItLabProfilePage";

export const Route = createFileRoute("/settings/codeitlab/profile")({
  component: CodeItLabProfilePage,
});

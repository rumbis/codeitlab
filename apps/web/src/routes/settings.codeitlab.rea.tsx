import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabReaPage } from "../components/codeitlab/CodeItLabReaPage";

export const Route = createFileRoute("/settings/codeitlab/rea")({
  component: CodeItLabReaPage,
});

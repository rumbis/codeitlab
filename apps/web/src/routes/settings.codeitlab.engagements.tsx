import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabEngagementsPage } from "../components/codeitlab/CodeItLabEngagementsPage";

export const Route = createFileRoute("/settings/codeitlab/engagements")({
  component: CodeItLabEngagementsPage,
});

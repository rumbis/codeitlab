import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabRemotePage } from "../components/codeitlab/CodeItLabRemotePage";

export const Route = createFileRoute("/settings/codeitlab/remote")({
  component: CodeItLabRemotePage,
});

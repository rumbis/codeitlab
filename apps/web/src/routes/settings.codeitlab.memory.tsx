import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabMemoryPage } from "../components/codeitlab/CodeItLabMemoryPage";

export const Route = createFileRoute("/settings/codeitlab/memory")({
  component: CodeItLabMemoryPage,
});

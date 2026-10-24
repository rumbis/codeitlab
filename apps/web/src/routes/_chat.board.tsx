import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabBoardPage } from "../components/codeitlab/CodeitlabBoardPage";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";

export const Route = createFileRoute("/_chat/board")({
  component: BoardRoutePage,
});

function BoardRoutePage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspacePageHeader className="bg-background">
        <h1 className="text-sm font-medium">Board</h1>
        <p className="truncate text-xs text-muted-foreground">
          Tasks move through four columns; starting one opens a normal thread.
        </p>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <CodeitlabBoardPage />
      </div>
    </div>
  );
}

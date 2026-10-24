import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabWallpaperPage } from "../components/codeitlab/CodeitlabWallpaperPage";

export const Route = createFileRoute("/settings/codeitlab/wallpaper")({
  component: CodeitlabWallpaperPage,
});

import type { CodeitlabMoodBoard } from "@codeitlab/core/moodboard";

let sequence = 0;

export function createMoodBoard(now: Date, name = "New board"): CodeitlabMoodBoard {
  sequence += 1;
  return {
    id: `mood-${now.getTime().toString(36)}-${sequence.toString(36)}`,
    name,
    projectId: "",
    colors: [],
    images: [],
    notes: [],
  };
}

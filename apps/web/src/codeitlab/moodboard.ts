import type { CodeItLabMoodBoard } from "@codeitlab/core/moodboard";

let sequence = 0;

export function createMoodBoard(now: Date, name = "New board"): CodeItLabMoodBoard {
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

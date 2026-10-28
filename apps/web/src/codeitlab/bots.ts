import type { CodeItLabBot } from "@codeitlab/core/bots";

let sequence = 0;

export function createBot(now: Date, name = "New bot"): CodeItLabBot {
  sequence += 1;
  return {
    id: `bot-${now.getTime().toString(36)}-${sequence.toString(36)}`,
    name,
    persona: "",
    memory: "",
    instanceId: "",
    model: "",
    enabled: true,
  };
}

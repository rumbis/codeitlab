/**
 * What the workspace is doing, reduced to the tone vocabulary every screen
 * already uses. The field is driven by real run state, never by decoration:
 * cyan while the agent works, amber when it is blocked on you, phosphor green
 * when it is settled.
 *
 * "awaiting" is not a variation of "working". A run that is waiting on an
 * approval or an answer is still in flight, so a room that only knew
 * running/stopped would keep breathing as if nothing had changed while the
 * agent sat idle behind a prompt the user never saw. That is the one state
 * where the surface must ask for attention rather than report progress.
 */
export type VibeSignalTone = "idle" | "working" | "awaiting";

export function vibeSignalTone(input: {
  readonly awaiting: boolean;
  readonly running: boolean;
}): VibeSignalTone {
  if (input.awaiting) return "awaiting";
  return input.running ? "working" : "idle";
}

import type {
  CodeItLabXpRecordInput,
  CodeItLabXpRecordResult,
  CodeItLabXpState,
} from "@codeitlab/contracts";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { playCodeItLabSfx } from "../../codeitlab/audio";
import { useCodeItLabEffectsSettings } from "../../codeitlab/effectsSettings";
import {
  useCodeItLabXp,
  useTurnCompletedRecording,
  xpAwardedAmount,
  xpLevelAriaLabel,
  xpRingDashOffset,
  xpRingProgress,
  xpStreakLabel,
} from "../../codeitlab/xp";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const RING_RADIUS = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const FEEDBACK_DURATION_MS = 150;

interface XpFeedback {
  readonly id: number;
  readonly amount: number;
  readonly settled: boolean;
}

/**
 * Level, streak and award feedback for the send button. It renders nothing at
 * all until the server has answered: a guessed level would be a lie, and zeros
 * would read as real progress.
 */
export function SendButtonXp() {
  const xp = useCodeItLabXp();
  const effects = useCodeItLabEffectsSettings();
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [feedback, setFeedback] = useState<XpFeedback | null>(null);
  const feedbackId = useRef(0);

  const recordTurn = async (
    input: CodeItLabXpRecordInput,
  ): Promise<CodeItLabXpRecordResult | null> => {
    const previous = xp.state;
    const result = await xp.record(input);
    if (result === null || !result.awarded) return result;
    const amount = xpAwardedAmount(previous, result.state);
    if (amount > 0) {
      feedbackId.current += 1;
      setFeedback({
        id: feedbackId.current,
        amount,
        settled: prefersReducedMotion,
      });
      if (effects.sfxEnabled) playCodeItLabSfx("success");
    }
    return result;
  };

  useTurnCompletedRecording(recordTurn);

  // One frame after the award, flip the feedback to its settled position so the
  // transition runs exactly once. Reduced motion starts settled and skips this.
  useEffect(() => {
    if (feedback === null || feedback.settled) return;
    const frame = window.requestAnimationFrame(() => {
      setFeedback((current) =>
        current === null || current.settled ? current : { ...current, settled: true },
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [feedback]);

  const state: CodeItLabXpState | null = xp.state;
  if (state === null) return null;

  const progress = xpRingProgress(state);
  const dashOffset = xpRingDashOffset(progress, RING_RADIUS);

  return (
    <span
      className="relative inline-flex shrink-0 items-center gap-1.5"
      data-send-button-xp="true"
      data-xp-level={state.level}
      data-xp-streak-days={state.streakDays}
      data-xp-total-xp={state.totalXp}
    >
      <span
        aria-label={xpLevelAriaLabel(state)}
        className="relative inline-flex size-6 shrink-0 items-center justify-center"
        data-xp-progress={progress}
        data-xp-ring="true"
        role="img"
      >
        <svg aria-hidden="true" className="absolute inset-0 size-6 -rotate-90" viewBox="0 0 24 24">
          <circle
            className="text-border"
            cx="12"
            cy="12"
            fill="none"
            r={RING_RADIUS}
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <circle
            className="text-codeitlab-green"
            cx="12"
            cy="12"
            data-xp-ring-offset={dashOffset}
            fill="none"
            r={RING_RADIUS}
            stroke="currentColor"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth="2.5"
          />
        </svg>
        <span
          aria-hidden="true"
          className="relative text-3xs font-semibold leading-none tabular-nums text-foreground"
        >
          {state.level}
        </span>
      </span>
      <span className="text-2xs tabular-nums text-muted-foreground" data-xp-streak="true">
        {xpStreakLabel(state)}
      </span>
      {feedback === null ? null : (
        <span
          key={feedback.id}
          className={cn(
            "pointer-events-none absolute -top-4 left-0 whitespace-nowrap text-2xs font-medium tabular-nums text-codeitlab-green",
            !prefersReducedMotion &&
              "transition-[opacity,transform] ease-out motion-reduce:transition-none",
            !prefersReducedMotion && !feedback.settled && "translate-y-1 opacity-0",
          )}
          data-xp-feedback={feedback.amount}
          data-xp-feedback-settled={feedback.settled ? "true" : "false"}
          style={
            prefersReducedMotion ? undefined : { transitionDuration: `${FEEDBACK_DURATION_MS}ms` }
          }
        >
          +{feedback.amount} XP
        </span>
      )}
    </span>
  );
}

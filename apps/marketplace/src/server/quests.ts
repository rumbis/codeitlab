import type { AccountRole } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { listEngagements } from "./engagements.ts";
import { getEmailNotificationPreference } from "./notifications.ts";
import { listSavedSearches } from "./savedSearches.ts";
import { listInterestsForCoder, listJobsForBusiness } from "./jobs.ts";
import { getBusinessProfile, getCoderProfile } from "./profiles.ts";
import { hasRatingForEngagement, ratingSummaryForCoder } from "./ratings.ts";
import { reputationForCoder } from "./reputation.ts";
import type { AccountRow } from "./types.ts";

/**
 * A quest is a real next step, not a badge. `done` is derived from what the
 * account has actually produced (a profile, an application, a delivery), so the
 * board can never congratulate someone for clicking. `lesson` is the 60-second
 * explanation shown exactly when the step becomes relevant, and `reward` names
 * the capability that unlocks — no points, no streaks, no confetti.
 */
export interface Quest {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly lesson: string;
  readonly reward: string;
  readonly href: string;
  readonly done: boolean;
}

export interface QuestBoard {
  readonly role: AccountRole;
  readonly quests: readonly Quest[];
  readonly done: number;
  readonly total: number;
  /** The first unfinished quest, or null when everything is done. */
  readonly next: Quest | null;
}

function board(role: AccountRole, quests: Quest[]): QuestBoard {
  const done = quests.filter((quest) => quest.done).length;
  return {
    role,
    quests,
    done,
    total: quests.length,
    next: quests.find((quest) => !quest.done) ?? null,
  };
}

function coderQuests(ctx: AppContext, account: AccountRow): Quest[] {
  const profile = getCoderProfile(ctx, account.id);
  const applications = listInterestsForCoder(ctx, account);
  const engagements = listEngagements(ctx, account);
  const delivered = engagements.some(
    (engagement) => engagement.status === "approved" || engagement.status === "paid_out",
  );
  const deliveredWithProof = engagements.some(
    (engagement) => engagement.deliveryEvidence.length > 0,
  );
  const reputation =
    profile === null ? null : reputationForCoder(ctx, profile.id, profile.currency);
  const ratings =
    profile === null ? { count: 0, average: 0 } : ratingSummaryForCoder(ctx, profile.id);
  const savedSearches = listSavedSearches(ctx, account.id);

  return [
    {
      id: "profile",
      title: "Publish your profile",
      detail: "Add your skills, rate range and availability.",
      lesson:
        "Businesses see your profile in the directory and in job matches. New profiles are reviewed before they are listed; you can already apply to jobs while you wait.",
      reward: "You appear in job matches",
      href: "/dashboard",
      done: profile !== null,
    },
    {
      id: "interests",
      title: "Declare the fields you want",
      detail: "Pick the kinds of work you actually want: web, video, data, ops, design, ai.",
      lesson:
        "Interests are a filter, not an advertisement: they change which jobs rank you higher. A job whose field matches your interests adds 15% to your match score.",
      reward: "+15% match score in your fields",
      href: "/dashboard",
      done: profile !== null && profile.interests.length > 0,
    },
    {
      id: "evidence",
      title: "Prove one thing",
      detail: "Link a repo, a case study or a shipped project.",
      lesson:
        "One evidence link is worth up to 15% of your match score and three links earn full credit. It is the only part of the score a business can open and check itself.",
      reward: "Up to +15% match score",
      href: "/dashboard",
      done: profile !== null && profile.evidence.length > 0,
    },
    {
      id: "apply",
      title: "Apply to one open job",
      detail: "Send the business one honest paragraph, not a template.",
      lesson:
        "The business sees your message next to the ranked coders. It is the only place where you can say something the score cannot.",
      reward: "Businesses can see your application",
      href: "/jobs",
      done: applications.length > 0,
    },
    {
      id: "deliver",
      title: "Deliver one paid engagement",
      detail: "Accept, work, mark delivered, get approved.",
      lesson:
        "Money is held in escrow: the business pays when it picks you, the platform holds it, and you are paid when the business approves the delivery. A cancel before delivery refunds the business.",
      reward: "Verified delivery badge and a lower fee tier later",
      href: "/dashboard",
      done: delivered,
    },
    {
      id: "proof",
      title: "Deliver with proof",
      detail: "Attach a note and up to five links when you mark work delivered.",
      lesson:
        "The business approves against your evidence, not against a status flag. A delivery with proof is approved faster, and only evidence-backed deliveries count toward your reputation.",
      reward: "Faster approval and credit toward Trusted",
      href: "/dashboard",
      done: deliveredWithProof,
    },
    {
      id: "trusted",
      title: "Reach Trusted reputation",
      detail: "Three paid deliveries with at least one evidence link.",
      lesson:
        "Reputation is derived from money that moved and evidence that was attached — there is nothing to claim or reset. Trusted is what a business sees on your card before it reads a word of your profile.",
      reward: "Trusted badge on your directory card",
      href: "/dashboard",
      done:
        reputation !== null && (reputation.level === "trusted" || reputation.level === "expert"),
    },
    {
      id: "search",
      title: "Save a job search",
      detail: "Filter /jobs by text, field or budget, then save the search.",
      lesson:
        "A saved search is checked on a schedule; when a new job matches, it lands in your feed and push with the first title. It never sends email, so the channel stays quiet for money and invitations — and you stop refreshing a list to find work.",
      reward: "Told when new work matches your filter",
      href: "/jobs",
      done: savedSearches.length > 0,
    },
    {
      id: "rating",
      title: "Get your first rating",
      detail: "Deliver work a business pays for; the rating arrives after the payout.",
      lesson:
        "Ratings are written only after money has moved, so nobody can rate you to win a negotiation. One honest score on your card answers the question every new business asks first.",
      reward: "A score on your directory card",
      href: "/dashboard",
      done: ratings.count > 0,
    },
  ];
}

function businessQuests(ctx: AppContext, account: AccountRow): Quest[] {
  const profile = getBusinessProfile(ctx, account.id);
  const jobs = listJobsForBusiness(ctx, account.id);
  const engagements = listEngagements(ctx, account);
  const approved = engagements.some(
    (engagement) => engagement.status === "approved" || engagement.status === "paid_out",
  );
  const approvedWithEvidence = engagements.some(
    (engagement) =>
      (engagement.status === "approved" || engagement.status === "paid_out") &&
      engagement.deliveryEvidence.length > 0,
  );
  const paidOut = engagements.filter((engagement) => engagement.status === "paid_out");
  const emailOn = getEmailNotificationPreference(ctx, account.id);

  return [
    {
      id: "company",
      title: "Add your company profile",
      detail: "Name, website and one paragraph about what you build.",
      lesson:
        "Coders see this on every job you post. A real company profile is the difference between a brief people trust and one they ignore.",
      reward: "Your jobs show who is behind them",
      href: "/dashboard",
      done: profile !== null,
    },
    {
      id: "post",
      title: "Post your first job",
      detail: "Scope, required skills, budget range and a timeline.",
      lesson:
        "A job needs a definition of done. The clearer the brief, the better the ranked coders match it — and the fewer messages you have to send.",
      reward: "Ranked coders with the reasons behind each score",
      href: "/dashboard",
      done: jobs.length > 0,
    },
    {
      id: "pick",
      title: "Pick a coder and fund escrow",
      detail: "Choose one coder and an amount within the budget.",
      lesson:
        "Funding escrow is the start signal: the money is charged when you pick, held by the platform, and only released when you approve the delivery.",
      reward: "Work starts with the money already secured",
      href: "/dashboard",
      done: engagements.length > 0,
    },
    {
      id: "approve",
      title: "Approve one delivery",
      detail: "Review the delivered work and release the payout.",
      lesson:
        "Approval records the platform fee and the payout in one append-only ledger. Nothing can change the amount after the charge.",
      reward: "A closed engagement and a receipt",
      href: "/dashboard",
      done: approved,
    },
    {
      id: "evidence_review",
      title: "Approve from evidence",
      detail: "Read the delivery note and open the proof links before you release the money.",
      lesson:
        "The approve button releases escrow. Evidence is what you check first — it turns approval from a leap of faith into a decision you can defend later.",
      reward: "A clean record and a dispute-free engagement",
      href: "/dashboard",
      done: approvedWithEvidence,
    },
    {
      id: "hear",
      title: "Turn on notifications",
      detail: "Push for this device and email for the events that need you.",
      lesson:
        "A delivery waiting for review is the one thing that costs a coder money while you are busy. Push reaches this device even with the tab closed; email is opt-in and covers only invitations, deliveries, approvals and disputes — never marketing. Both can be turned off in one click.",
      reward: "You hear about a delivery without refreshing",
      href: "/dashboard",
      done: emailOn,
    },
    {
      id: "rate",
      title: "Rate the work you paid for",
      detail: "One score and, if you want, one sentence about the delivery.",
      lesson:
        "A rating is written after the payout, so it can never be used to negotiate money. It is how the next business decides whom to trust, and it is why the directory is worth browsing.",
      reward: "A directory that gets more useful every time someone pays",
      href: "/dashboard",
      done: paidOut.some((engagement) => hasRatingForEngagement(ctx, engagement.id)),
    },
  ];
}

/** The quest board for an account, derived from its real work. */
export function questsFor(ctx: AppContext, account: AccountRow): QuestBoard {
  return board(
    account.role,
    account.role === "coder" ? coderQuests(ctx, account) : businessQuests(ctx, account),
  );
}

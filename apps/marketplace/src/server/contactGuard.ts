import { badRequest } from "./errors.ts";

/**
 * Escrow only works if the conversation that leads to money stays here. A coder
 * who writes "email me at …" into an application, or a business that invites a
 * coder and asks for a phone number, is one step away from paying off-platform —
 * and then nobody is protected. So the two private messages refuse contact
 * details *before* an engagement exists. Public job descriptions and delivery
 * evidence keep links on purpose: a brief may point at a product, and evidence
 * is where a repo or a deploy belongs.
 */
export type ContactKind = "email" | "phone" | "link";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const LINK_PATTERN =
  /\b(?:https?:\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|dev|net|org|ai|co|gr)(?:\/\S*)?)\b/iu;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{5,}\d/gu;

function phoneDigits(value: string): number {
  return (value.match(/\d/gu) ?? []).length;
}

export function findOffPlatformContact(text: string): ContactKind | null {
  if (EMAIL_PATTERN.test(text)) return "email";
  if (LINK_PATTERN.test(text)) return "link";
  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    if (phoneDigits(match[0]) >= 7) return "phone";
  }
  return null;
}

const MESSAGE: Record<ContactKind, string> = {
  email:
    "Remove the email address. Until an engagement exists, contact stays inside CodeItLab — that is what keeps the escrow and the evidence in one place.",
  phone:
    "Remove the phone number. Until an engagement exists, contact stays inside CodeItLab — that is what keeps the escrow and the evidence in one place.",
  link: "Remove the link. Until an engagement exists, contact stays inside CodeItLab; links belong in the delivery evidence once work is underway.",
};

export function assertNoOffPlatformContact(text: string, field: string): void {
  const kind = findOffPlatformContact(text);
  if (kind !== null) {
    throw badRequest(MESSAGE[kind], `off_platform_contact_${field}`);
  }
}

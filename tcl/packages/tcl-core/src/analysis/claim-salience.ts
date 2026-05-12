/**
 * Filters junk / low-information utterances from graph and issue pipelines.
 * High-stakes insurance / compliance language always stays salient.
 */

const HIGH_STAKES =
  /\b(approval|approved|qualify|eligible|underwriting|carrier|coverage|waiting period|graded|death benefit|beneficiary|premium|policy|enrollment|consent|guarantee|guaranteed|disclosure|waiting|packet|emailed|sent|rate|plan|benefit|medical|health|exam|contestability)\b/i;

const FILLER_ONLY = /^(great|good|okay|ok|alright|sure|right|thanks|thank you|yes sir|yes ma'?am|no problem|sounds good|understood|i understand|i see|got it|hello|hi there|bye|goodbye)\.?$/i;

const TIMESTAMP_FRAGMENT = /^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*$/i;

export interface SalienceResult {
  isSalient: boolean;
  salienceScore: number;
  dropReason?: string;
}

export function evaluateClaimSalience(text: string, _claimType?: string): SalienceResult {
  const t = text.trim();
  const low = t.toLowerCase();

  if (t.length === 0) {
    return { isSalient: false, salienceScore: 0, dropReason: "empty" };
  }

  if (TIMESTAMP_FRAGMENT.test(t) || /^\[\d{1,2}:\d{2}\]\s*$/i.test(low)) {
    return { isSalient: false, salienceScore: 0, dropReason: "timestamp_fragment" };
  }

  if (FILLER_ONLY.test(low) && !HIGH_STAKES.test(t)) {
    return { isSalient: false, salienceScore: 0.05, dropReason: "filler_or_acknowledgement" };
  }

  if (t.length < 12 && !HIGH_STAKES.test(t)) {
    return { isSalient: false, salienceScore: 0.15, dropReason: "too_short_non_material" };
  }

  if (HIGH_STAKES.test(t)) {
    return { isSalient: true, salienceScore: 0.95 };
  }

  if (t.length >= 24) {
    return { isSalient: true, salienceScore: 0.55 };
  }

  return { isSalient: true, salienceScore: 0.35 };
}

import type { BusinessInsight, Claim } from "../types.js";

const PATTERNS: Array<{
  type: BusinessInsight["type"];
  pattern: RegExp;
  summary: (m: string) => string;
  action: string;
  impact: string;
  confidence: number;
}> = [
  {
    type: "PROTECTQA_HEALTH_CONDITION_SIGNAL",
    pattern: /\b(diabetes|cancer|oxygen|heart|copd|stroke|hospital)\b/i,
    summary: (m: string) => `Health factor mentioned (${m.trim().slice(0, 80)}) — underwriting relevance`,
    action: "Route to licensed agent review against carrier guideline",
    impact: "Qualification blocker / product-type signal",
    confidence: 0.82,
  },
  {
    type: "CUSTOMER_OBJECTION",
    pattern: /\b(too expensive|don't trust|not interested|no thank you|sounds like a scam)\b/i,
    summary: (m: string) => `Customer objection signal: "${m.trim().slice(0, 100)}"`,
    action: "Address trust & pricing objections with disclosures and softer reassurances",
    impact: "Customer dispute / conversion risk",
    confidence: 0.85,
  },
  {
    type: "PROTECTQA_PRICE_SENSITIVITY",
    pattern: /\b(can'?t afford|budget|cheap|cost too much)\b/i,
    summary: () => "Price sensitivity surfaced",
    action: "Compare product tiers with compliant rate language",
    impact: "Revenue opportunity",
    confidence: 0.8,
  },
  {
    type: "PROTECTQA_BURIAL_COST_CONCERN",
    pattern: /\b(funeral|burial|final expense|casket|cemetery)\b/i,
    summary: () => "Burial/final-expense motive discussed",
    action: "Align benefit discussion with disclosures and customer's stated goal",
    impact: "Sales insight",
    confidence: 0.78,
  },
  {
    type: "CHURN_RISK",
    pattern: /\b(cancel|switch carriers|already have insurance|calling to cancel)\b/i,
    summary: () => "Potential churn / replacement conversation",
    action: "Validate existing coverage before replacement recommendations",
    impact: "Churn risk",
    confidence: 0.8,
  },
  {
    type: "BUYING_INTENT",
    pattern: /\b(let'?s move forward|ready to apply|when can i start)\b/i,
    summary: () => "Buying intent language detected",
    action: "Ensure compliant application steps & carrier disclosures precede signup",
    impact: "Revenue opportunity",
    confidence: 0.75,
  },
  {
    type: "PROTECTQA_POLICY_TYPE_CONFUSION",
    pattern: /\b(what'?s the difference between|confused about|don'?t understand)\b/i,
    summary: () => "Customer confusion about product concepts",
    action: "Use plain-language explainers and confirm understanding",
    impact: "Customer confusion",
    confidence: 0.72,
  },
  {
    type: "PROTECTQA_CALL_BACK_REQUEST",
    pattern: /\b(call me back|talk to my (?:son|daughter|spouse)|need to think)\b/i,
    summary: () => "Deferred decision / callback request",
    action: "Schedule compliant follow-up and document consent",
    impact: "Process improvement",
    confidence: 0.7,
  },
  {
    type: "FEATURE_REQUEST",
    pattern: /\b(wish you (?:had|offered)|do you have|can you add)\b/i,
    summary: () => "Exploratory feature or product ask",
    action: "Route product feedback to PM with transcript snippet",
    impact: "Product insight",
    confidence: 0.65,
  },
];

export function mineBusinessInsights(claims: Claim[]): { insights: BusinessInsight[]; businessValueScore: number } {
  const insights: BusinessInsight[] = [];
  for (const claim of claims) {
    if (claim.meta?.speakerType !== "customer") continue;
    const text = claim.text;
    for (const p of PATTERNS) {
      const match = text.match(p.pattern);
      if (match) {
        insights.push({
          type: p.type,
          summary: p.summary(match[0]),
          evidenceQuote: text.length > 160 ? `${text.slice(0, 157)}…` : text,
          speaker: claim.meta?.speaker ?? "Customer",
          turnIndex: claim.meta?.turnIndex,
          confidence: p.confidence,
          recommendedAction: p.action,
          businessImpact: p.impact,
        });
        break;
      }
    }
  }
  const unique = dedupeInsights(insights);
  const businessValueScore = Math.min(100, 35 + unique.length * 12 + unique.reduce((s, i) => s + i.confidence * 8, 0));
  return { insights: unique.slice(0, 25), businessValueScore: Math.round(businessValueScore) };
}

function dedupeInsights(list: BusinessInsight[]): BusinessInsight[] {
  const seen = new Set<string>();
  const out: BusinessInsight[] = [];
  for (const i of list) {
    const key = `${i.type}:${i.turnIndex}:${i.summary.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

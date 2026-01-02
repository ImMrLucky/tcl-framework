/**
 * Review Items Generator
 * 
 * Creates actionable "Top Review Items" from the analysis.
 * This is the "money output" - what users actually need to see.
 */

import { createHash } from "crypto";
import type { 
  Claim, 
  ContradictionEdge, 
  DestructiveClaim, 
  ReviewItem, 
  ReviewSeverity 
} from "./types.js";
import { getScoringConfig } from "./config/scoring.js";

// ============================================================================
// ACTION TEMPLATES - Domain-specific recommendations
// ============================================================================

const ACTION_TEMPLATES: Record<string, { title: string; action: string }> = {
  billing_contradiction: {
    title: "Billing statement conflict",
    action: "Review billing statements for accuracy. Consider adding specific dollar amounts and dates.",
  },
  fee_contradiction: {
    title: "Fee disclosure conflict",
    action: "Clarify fee policy. Provide written confirmation of applicable fees.",
  },
  plan_contradiction: {
    title: "Plan details conflict",
    action: "Verify plan details match customer expectations. Provide plan documentation.",
  },
  termination_contradiction: {
    title: "Cancellation terms conflict",
    action: "Clarify cancellation terms. Provide written copy of termination policy.",
  },
  promise_unverified: {
    title: "Agent promise not confirmed",
    action: "Follow up on agent commitment. Document the promised action was completed.",
  },
  ungrounded_claim: {
    title: "Claim lacks evidence",
    action: "Provide supporting documentation or transcript reference for this claim.",
  },
  destructive_high: {
    title: "High-risk statement",
    action: "Review this statement carefully. Consider whether it creates liability.",
  },
};

// ============================================================================
// REVIEW ITEM GENERATION
// ============================================================================

/**
 * Generate review items from contradictions.
 */
function reviewItemsFromContradictions(
  contradictions: ContradictionEdge[],
  claims: Claim[],
  config = getScoringConfig()
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const claimMap = new Map(claims.map(c => [c.id, c]));
  
  // Filter to DIRECT contradictions only
  const directContradictions = contradictions.filter(
    c => c.contradictionType === "direct" || !c.contradictionType
  );
  
  // Sort by weight (highest first)
  const sorted = [...directContradictions].sort((a, b) => b.weight - a.weight);
  
  // Take top K
  const topK = sorted.slice(0, config.review.topKContradictions);
  
  for (const contra of topK) {
    const claimA = claimMap.get(contra.claimA);
    const claimB = claimMap.get(contra.claimB);
    
    if (!claimA || !claimB) continue;
    
    // Determine category based on keywords
    const category = detectContradictionCategory(claimA.text, claimB.text);
    const template = ACTION_TEMPLATES[`${category}_contradiction`] || ACTION_TEMPLATES.billing_contradiction;
    
    // Determine severity based on weight
    let severity: ReviewSeverity = "medium";
    if (contra.weight >= 0.8) severity = "critical";
    else if (contra.weight >= 0.6) severity = "high";
    else if (contra.weight < 0.4) severity = "low";
    
    items.push({
      id: generateReviewId("contra", contra.claimA, contra.claimB),
      title: template.title,
      severity,
      category: "contradiction",
      whyItMatters: `These statements appear to conflict. ${claimA.meta?.speaker || "Speaker"} said one thing, then ${claimB.meta?.speaker || "another speaker"} said something different.`,
      
      involvedClaimIds: [contra.claimA, contra.claimB],
      claimTexts: [claimA.text, claimB.text],
      speakerLabels: [claimA.meta?.speaker || "Unknown", claimB.meta?.speaker || "Unknown"],
      
      recommendedAction: template.action,
      actionTemplate: `${category}_contradiction`,
      
      drivers: {
        contradictionWeight: contra.weight,
        overlapScore: contra.overlapScore,
        reasonCodes: contra.reasonCodes,
      },
    });
  }
  
  return items;
}

/**
 * Generate review items from destructive claims.
 */
function reviewItemsFromDestructiveClaims(
  destructiveClaims: DestructiveClaim[],
  claims: Claim[],
  config = getScoringConfig()
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const claimMap = new Map(claims.map(c => [c.id, c]));
  
  // Sort by importance (highest first)
  const sorted = [...destructiveClaims].sort((a, b) => b.importance - a.importance);
  
  // Take top K
  const topK = sorted.slice(0, config.review.topKDestructiveClaims);
  
  for (const dc of topK) {
    const claim = claimMap.get(dc.claimId);
    if (!claim) continue;
    
    // Determine severity
    let severity: ReviewSeverity = "medium";
    if (dc.importance >= 0.8) severity = "critical";
    else if (dc.importance >= 0.6) severity = "high";
    else if (dc.importance < 0.4) severity = "low";
    
    // Build why it matters from reasons
    const reasons = dc.reasons.map(r => r.kind).join(", ");
    
    items.push({
      id: generateReviewId("destructive", dc.claimId),
      title: "High-risk statement flagged",
      severity,
      category: "destructive",
      whyItMatters: `This statement was flagged for: ${reasons}. It may create compliance or liability risk.`,
      
      involvedClaimIds: [dc.claimId],
      claimTexts: [dc.text],
      speakerLabels: [claim.meta?.speaker || "Unknown"],
      
      recommendedAction: ACTION_TEMPLATES.destructive_high.action,
      actionTemplate: "destructive_high",
      
      drivers: {
        nodeBlameNorm: dc.nodeBlameNorm,
        destructiveImportance: dc.importance,
      },
    });
  }
  
  return items;
}

/**
 * Generate review items from ungrounded claims (promises without follow-up).
 */
function reviewItemsFromUngroundedPromises(
  claims: Claim[]
): ReviewItem[] {
  const items: ReviewItem[] = [];
  
  // Find agent promises that aren't grounded
  const ungroundedPromises = claims.filter(c => 
    c.claimKind === "promise" && 
    (!c.grounding || c.grounding.kind === "none")
  );
  
  for (const claim of ungroundedPromises.slice(0, 3)) { // Max 3
    items.push({
      id: generateReviewId("promise", claim.id),
      title: "Agent promise not confirmed",
      severity: "medium",
      category: "promise_unverified",
      whyItMatters: "An agent made a commitment that may not have been followed through.",
      
      involvedClaimIds: [claim.id],
      claimTexts: [claim.text],
      speakerLabels: [claim.meta?.speaker || "Agent"],
      
      recommendedAction: ACTION_TEMPLATES.promise_unverified.action,
      actionTemplate: "promise_unverified",
      
      drivers: {},
    });
  }
  
  return items;
}

// ============================================================================
// MAIN GENERATOR
// ============================================================================

export interface ReviewItemsInput {
  claims: Claim[];
  contradictions: ContradictionEdge[];
  destructiveClaims?: DestructiveClaim[];
}

/**
 * Generate all review items from analysis results.
 * This is the main entry point.
 */
export function generateReviewItems(input: ReviewItemsInput): ReviewItem[] {
  const config = getScoringConfig();
  const allItems: ReviewItem[] = [];
  
  // 1. From contradictions (highest priority)
  allItems.push(...reviewItemsFromContradictions(
    input.contradictions, 
    input.claims, 
    config
  ));
  
  // 2. From destructive claims
  if (input.destructiveClaims) {
    allItems.push(...reviewItemsFromDestructiveClaims(
      input.destructiveClaims,
      input.claims,
      config
    ));
  }
  
  // 3. From ungrounded promises
  allItems.push(...reviewItemsFromUngroundedPromises(input.claims));
  
  // Sort by severity (critical > high > medium > low)
  const severityOrder: Record<ReviewSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  
  allItems.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  
  // Return top K
  return allItems.slice(0, config.review.topKReviewItems);
}

// ============================================================================
// HELPERS
// ============================================================================

function generateReviewId(...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join(":")).digest("hex").substring(0, 12);
  return `review_${hash}`;
}

function detectContradictionCategory(textA: string, textB: string): string {
  const combined = `${textA} ${textB}`.toLowerCase();
  
  if (combined.includes("fee") || combined.includes("charge") || combined.includes("penalty")) {
    return "fee";
  }
  if (combined.includes("cancel") || combined.includes("terminat")) {
    return "termination";
  }
  if (combined.includes("plan") || combined.includes("package") || combined.includes("subscription")) {
    return "plan";
  }
  if (combined.includes("bill") || combined.includes("rate") || combined.includes("cost") || combined.includes("price")) {
    return "billing";
  }
  
  return "billing"; // Default
}


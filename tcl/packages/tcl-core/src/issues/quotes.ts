/**
 * Quote Extraction - Extract exact evidence quotes from claims
 * 
 * CRITICAL: Quotes must be EXACT (not truncated) for audit defensibility.
 */

import type { Claim } from '../../types.js';
import type { EvidenceSnippet } from './types.js';

export interface QuoteExtraction {
  quoteId: string;
  claimId: string;
  speaker: "Agent"|"Customer"|"System";
  turnIndex: number;
  lineSpan?: [number, number];
  text: string;                // exact quote (not truncated)
  evidenceRef?: { type:"Call"|"Policy"|"KB"; ref: string; };
}

/**
 * Extract exact quote from a claim.
 * 
 * Returns the FULL text of the claim, not truncated.
 * UI should handle truncation in list views, but detail views must show full text.
 */
export function extractQuote(claim: Claim, claimIndex: number): QuoteExtraction {
  // Map speaker labels
  const speakerMap: Record<string, "Agent"|"Customer"|"System"> = {
    'AGENT': 'Agent',
    'CUSTOMER': 'Customer',
    'Customer': 'Customer',
    'Agent': 'Agent',
    'SYSTEM': 'System',
    'System': 'System'
  };
  
  const speaker = speakerMap[claim.meta?.speaker || 'UNKNOWN'] || 'Agent';
  
  // Get turn index
  const turnIndex = claim.meta?.turnIndex ?? claimIndex;
  
  // Get exact text (never truncate here - UI handles truncation)
  const text = claim.text || '';
  
  // Generate quote ID
  const quoteId = `quote_${claim.id}_${claimIndex}`;
  
  // Extract line span if available from evidence
  let lineSpan: [number, number] | undefined;
  if (claim.evidence && claim.evidence.length > 0) {
    const firstEvidence = claim.evidence[0];
    if (firstEvidence.span) {
      // Parse span like "lines 10-15" or "10:15"
      const spanMatch = firstEvidence.span.match(/(\d+)[-:](\d+)/);
      if (spanMatch) {
        lineSpan = [parseInt(spanMatch[1]), parseInt(spanMatch[2])];
      }
    }
  }
  
  // Check for external evidence references
  let evidenceRef: { type:"Call"|"Policy"|"KB"; ref: string; } | undefined;
  if (claim.evidence && claim.evidence.length > 0) {
    const externalEvidence = claim.evidence.find(e => e.source_id && !e.source_id.startsWith('turn_'));
    if (externalEvidence) {
      if (externalEvidence.source_id.includes('policy') || externalEvidence.source_id.includes('Policy')) {
        evidenceRef = { type: 'Policy', ref: externalEvidence.source_id };
      } else if (externalEvidence.source_id.includes('kb') || externalEvidence.source_id.includes('KB')) {
        evidenceRef = { type: 'KB', ref: externalEvidence.source_id };
      } else {
        evidenceRef = { type: 'Call', ref: externalEvidence.source_id };
      }
    }
  }
  
  return {
    quoteId,
    claimId: claim.id,
    speaker,
    turnIndex,
    lineSpan,
    text,  // EXACT quote - never truncated
    evidenceRef
  };
}

/**
 * Extract quotes for multiple claims.
 */
export function extractQuotes(claims: Claim[]): QuoteExtraction[] {
  return claims.map((claim, index) => extractQuote(claim, index));
}

/**
 * Find quote by claim ID.
 */
export function findQuoteByClaimId(quotes: QuoteExtraction[], claimId: string): QuoteExtraction | undefined {
  return quotes.find(q => q.claimId === claimId);
}


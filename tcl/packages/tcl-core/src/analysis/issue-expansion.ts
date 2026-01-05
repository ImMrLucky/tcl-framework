/**
 * Issue Expansion Module
 * 
 * Expands graph edges into enterprise-grade IssueV2 objects.
 * Implements comprehensive issue generation:
 * - A: Contradiction edges → CONTRADICTION issues
 * - B: Unverified claims → UNVERIFIED_CLAIM issues
 * - C: Ungrounded claims → UNGROUNDED issues
 * - D: Risk signals → RISK_SIGNAL issues
 * - E: Policy violations → POLICY issues (if enabled)
 */

import { createHash } from 'crypto';
import type {
  Claim,
  ContradictionEdge,
  SupportEdge,
  GroundingEdge,
  IssueV2,
  IssueTypeV2,
  IssueCategoryV2,
  SpeakerV2,
  VerificationLevelV2,
} from '../types.js';
import { getRiskRankingConfig } from '../config/risk-ranking.js';

export interface IssueExpansionInput {
  claims: Claim[];
  contradictions: ContradictionEdge[];
  supports: SupportEdge[];
  grounding: GroundingEdge[];
  runId: string;
  conversationId: string;
  evidenceMode: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL';
  audit: {
    engineVersion: string;
    scorerId: string;
    modelFingerprint?: any;
    configHash?: string;
    inputHash?: string;
  };
  // Optional: spectral results for structural importance
  spectralResults?: {
    nodeBlameNorm?: Record<string, number>;
    truthStates?: Record<string, string>;
  };
}

export interface IssueExpansionOutput {
  allIssues: IssueV2[];
  issuesByClaim: Record<string, IssueV2[]>; // Per-claim issues
  issueKeys: Set<string>; // For deduplication tracking
}

/**
 * Main entry point: Expand graph edges into issues
 */
export function expandIssueCandidates(input: IssueExpansionInput): IssueExpansionOutput {
  const issues: IssueV2[] = [];
  const issueKeys = new Set<string>();
  const claimMap = new Map(input.claims.map(c => [c.id, c]));
  const config = getRiskRankingConfig();
  const evidenceQuotesMax = config.issueLimits?.evidenceQuotesMax || 5;
  
  // Build grounded claim IDs
  const groundedClaimIds = new Set(input.grounding.map(g => g.claimId));
  
  // Build contradicted claim IDs (to avoid duplicate issues)
  const contradictedClaimIds = new Set<string>();
  for (const edge of input.contradictions) {
    contradictedClaimIds.add(edge.claimA);
    contradictedClaimIds.add(edge.claimB);
  }
  
  // Rule A: Contradiction edges → CONTRADICTION issues
  for (const edge of input.contradictions) {
    const issue = createContradictionIssue(edge, claimMap, input, evidenceQuotesMax);
    if (issue && !issueKeys.has(issue.issueKey)) {
      issues.push(issue);
      issueKeys.add(issue.issueKey);
    }
  }
  
  // Rule B: Unverified claims → UNVERIFIED_CLAIM issues
  // Only in transcript-only mode, and only for agent assertions/promises
  if (input.evidenceMode === 'TRANSCRIPT_ONLY') {
    for (const claim of input.claims) {
      const truthState = claim.truthState?.toUpperCase();
      const isUnverified = truthState === 'UNVERIFIED';
      const hasGrounding = groundedClaimIds.has(claim.id) || (claim.evidenceRefs?.length ?? 0) > 0;
      const isAgent = claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT';
      const isAssertionOrPromise = claim.claimKind === 'assertion' || claim.claimKind === 'promise';
      
      // Only flag agent assertions/promises that are unverified
      // Skip if already contradicted (handled by Rule A)
      if (isUnverified && hasGrounding && isAgent && isAssertionOrPromise && !contradictedClaimIds.has(claim.id)) {
        const issue = createUnverifiedClaimIssue(claim, input, evidenceQuotesMax);
        if (issue && !issueKeys.has(issue.issueKey)) {
          issues.push(issue);
          issueKeys.add(issue.issueKey);
        }
      }
    }
  }
  
  // Rule C: Ungrounded claims → UNGROUNDED issues
  // Claims with no grounding edges at all
  for (const claim of input.claims) {
    const truthState = claim.truthState?.toUpperCase();
    const isUngrounded = truthState === 'UNGROUNDED' || (!groundedClaimIds.has(claim.id) && (claim.evidenceRefs?.length ?? 0) === 0);
    const isAgent = claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT';
    const isAssertionOrPromise = claim.claimKind === 'assertion' || claim.claimKind === 'promise';
    
    // Only flag agent assertions/promises that are ungrounded
    // Skip if already contradicted or unverified (handled by Rules A & B)
    if (isUngrounded && isAgent && isAssertionOrPromise && 
        !contradictedClaimIds.has(claim.id) && 
        !issueKeys.has(`unverified:${claim.id}`)) {
      const issue = createUngroundedClaimIssue(claim, input, evidenceQuotesMax);
      if (issue && !issueKeys.has(issue.issueKey)) {
        issues.push(issue);
        issueKeys.add(issue.issueKey);
      }
    }
  }
  
  // Rule D: Risk signals → RISK_SIGNAL issues
  // High-impact assertions: money, fees, cancellation, refund promises, legal threats
  for (const claim of input.claims) {
    const isAgent = claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT';
    const isAssertionOrPromise = claim.claimKind === 'assertion' || claim.claimKind === 'promise';
    
    if (isAgent && isAssertionOrPromise) {
      const riskSignals = detectRiskSignals(claim);
      if (riskSignals.length > 0 && !contradictedClaimIds.has(claim.id)) {
        const issue = createRiskSignalIssue(claim, input, riskSignals, evidenceQuotesMax);
        if (issue && !issueKeys.has(issue.issueKey)) {
          issues.push(issue);
          issueKeys.add(issue.issueKey);
        }
      }
    }
  }
  
  // Rule E: Policy violations → POLICY issues
  // Placeholder for future policy matching (if enabled)
  // Currently skipped - implement when policy matching is available
  
  // Group issues by claim
  const issuesByClaim: Record<string, IssueV2[]> = {};
  for (const issue of issues) {
    const claimId = issue.what.primaryClaimId;
    if (!issuesByClaim[claimId]) {
      issuesByClaim[claimId] = [];
    }
    issuesByClaim[claimId].push(issue);
  }
  
  // Apply per-claim limits
  const perClaimMax = config.issueLimits?.perClaimMax || 10;
  for (const claimId in issuesByClaim) {
    if (issuesByClaim[claimId].length > perClaimMax) {
      // Sort by risk score (will be computed later, but sort by type priority for now)
      issuesByClaim[claimId].sort((a, b) => {
        const typeAIdx = config.typePriority.indexOf(a.type);
        const typeBIdx = config.typePriority.indexOf(b.type);
        return typeAIdx - typeBIdx; // Lower index = higher priority
      });
      issuesByClaim[claimId] = issuesByClaim[claimId].slice(0, perClaimMax);
    }
  }
  
  return {
    allIssues: issues,
    issuesByClaim,
    issueKeys,
  };
}

/**
 * Rule A: Create CONTRADICTION issue from edge
 */
function createContradictionIssue(
  edge: ContradictionEdge,
  claimMap: Map<string, Claim>,
  input: IssueExpansionInput,
  evidenceQuotesMax: number
): IssueV2 | null {
  const claimA = claimMap.get(edge.claimA);
  const claimB = claimMap.get(edge.claimB);
  
  if (!claimA || !claimB) {
    return null;
  }
  
  // Stable dedupe key: contradiction:${min(a,b)}:${max(a,b)}
  const sortedIds = [edge.claimA, edge.claimB].sort();
  const issueKey = `contradiction:${sortedIds[0]}:${sortedIds[1]}`;
  const issueId = generateIssueId(input.runId, issueKey);
  
  // Extract evidence refs (best quotes from each claim, limited by config)
  const evidenceRefs = [];
  if (claimA.evidenceRefs && claimA.evidenceRefs.length > 0) {
    evidenceRefs.push(...claimA.evidenceRefs.slice(0, evidenceQuotesMax).map(ref => ({
      sourceType: 'TRANSCRIPT' as const,
      sourceId: ref.sourceId || `e-transcript-${ref.turnIndex || 0}`,
      quote: ref.quote || claimA.text,
      weight: ref.weight,
      turnIndex: ref.turnIndex,
    })));
  }
  if (claimB.evidenceRefs && claimB.evidenceRefs.length > 0) {
    evidenceRefs.push(...claimB.evidenceRefs.slice(0, evidenceQuotesMax).map(ref => ({
      sourceType: 'TRANSCRIPT' as const,
      sourceId: ref.sourceId || `e-transcript-${ref.turnIndex || 0}`,
      quote: ref.quote || claimB.text,
      weight: ref.weight,
      turnIndex: ref.turnIndex,
    })));
  }
  
  // Determine speaker (prioritize agent)
  const speaker: SpeakerV2 = 
    claimA.meta?.speaker === 'Agent' || claimA.meta?.speaker === 'AGENT' ? 'AGENT' :
    claimB.meta?.speaker === 'Agent' || claimB.meta?.speaker === 'AGENT' ? 'AGENT' :
    claimA.meta?.speaker === 'Customer' || claimA.meta?.speaker === 'CUSTOMER' ? 'CUSTOMER' :
    'UNKNOWN';
  
  const turnIndex = claimA.meta?.turnIndex ?? claimB.meta?.turnIndex;
  
  // Determine verification level
  const verificationLevel: VerificationLevelV2 = 
    input.evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL' ? 'EXTERNAL_VERIFIED' : 'TRANSCRIPT_ONLY';
  
  // Compliance tags
  const complianceTags = ['consistency', 'customer_dispute_risk'];
  if (claimA.claimKind === 'promise' || claimB.claimKind === 'promise') {
    complianceTags.push('commitment_risk');
  }
  
  // Disclaimers for transcript-only
  const disclaimers: string[] = [];
  if (input.evidenceMode === 'TRANSCRIPT_ONLY') {
    disclaimers.push('This finding is grounded in transcript content only and is not externally verified.');
  }
  
  return {
    issueId,
    issueKey,
    runId: input.runId,
    conversationId: input.conversationId,
    type: 'CONTRADICTION',
    category: 'consistency',
    severity: 'medium', // Will be recomputed by ranking
    riskScore: 0, // Will be computed by ranking
    confidence: edge.weight || 0.7,
    reviewRequired: true,
    verification: {
      level: verificationLevel,
      reasonCodes: input.evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
    },
    who: {
      speaker,
      turnIndex,
    },
    what: {
      primaryClaimId: edge.claimA,
      relatedClaimIds: [edge.claimB],
      claimText: claimA.text,
      issueSummary: `Contradiction detected between claims: "${claimA.text.substring(0, 60)}..." and "${claimB.text.substring(0, 60)}..."`,
      issueDetail: `Claim "${claimA.text}" (${edge.claimA}) contradicts claim "${claimB.text}" (${edge.claimB}). This inconsistency may indicate miscommunication, policy violation, or factual error.`,
    },
    evidence: {
      refs: evidenceRefs,
      edges: [{
        kind: 'contradiction',
        claimA: edge.claimA,
        claimB: edge.claimB,
        weight: edge.weight || 0.7,
      }],
    },
    compliance: {
      tags: complianceTags,
      impactedPolicies: [], // Empty in transcript-only
      legalHoldSuggested: false, // Will be recomputed by ranking
      disclaimers,
    },
    audit: {
      createdAt: new Date().toISOString(),
      engineVersion: input.audit.engineVersion,
      scorerId: input.audit.scorerId,
      modelFingerprint: input.audit.modelFingerprint,
      configHash: input.audit.configHash,
      inputHash: input.audit.inputHash,
    },
  };
}

/**
 * Rule B: Create UNVERIFIED_CLAIM issue
 */
function createUnverifiedClaimIssue(
  claim: Claim,
  input: IssueExpansionInput,
  evidenceQuotesMax: number
): IssueV2 | null {
  const issueKey = `unverified:${claim.id}`;
  const issueId = generateIssueId(input.runId, issueKey);
  
  // Extract evidence refs (transcript quotes, limited by config)
  const evidenceRefs = (claim.evidenceRefs || []).slice(0, evidenceQuotesMax).map(ref => ({
    sourceType: 'TRANSCRIPT' as const,
    sourceId: ref.sourceId || `e-transcript-${ref.turnIndex || 0}`,
    quote: ref.quote || claim.text,
    weight: ref.weight,
    turnIndex: ref.turnIndex,
  }));
  
  // If no evidenceRefs, try to create from grounding edges
  if (evidenceRefs.length === 0) {
    const groundingEdge = input.grounding.find(g => g.claimId === claim.id);
    if (groundingEdge) {
      evidenceRefs.push({
        sourceType: 'TRANSCRIPT',
        sourceId: groundingEdge.sourceId || `e-transcript-${claim.meta?.turnIndex || 0}`,
        quote: groundingEdge.quote || claim.text,
        weight: groundingEdge.weight,
        turnIndex: claim.meta?.turnIndex,
      });
    }
  }
  
  const speaker: SpeakerV2 = 
    claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT' ? 'AGENT' :
    claim.meta?.speaker === 'Customer' || claim.meta?.speaker === 'CUSTOMER' ? 'CUSTOMER' :
    'UNKNOWN';
  
  // Compliance tags
  const complianceTags: string[] = [];
  if (claim.claimKind === 'promise') {
    complianceTags.push('commitment_risk', 'promise_tracking');
  }
  if (claim.text.toLowerCase().includes('fee') || claim.text.toLowerCase().includes('charge')) {
    complianceTags.push('fee_disclosure');
  }
  
  // Disclaimers
  const disclaimers: string[] = [
    'This finding is grounded in transcript content only and is not externally verified.',
  ];
  
  return {
    issueId,
    issueKey,
    runId: input.runId,
    conversationId: input.conversationId,
    type: 'UNVERIFIED_CLAIM',
    category: 'evidence',
    severity: 'low', // Will be recomputed by ranking
    riskScore: 0, // Will be computed by ranking
    confidence: claim.confidence || 0.7,
    reviewRequired: true, // Agent assertions/promises require review
    verification: {
      level: 'TRANSCRIPT_ONLY',
      reasonCodes: ['NO_EXTERNAL_EVIDENCE'],
    },
    who: {
      speaker,
      turnIndex: claim.meta?.turnIndex,
    },
    what: {
      primaryClaimId: claim.id,
      claimText: claim.text,
      issueSummary: `Unverified claim: "${claim.text.substring(0, 80)}..."`,
      issueDetail: `Claim "${claim.text}" (${claim.id}) is grounded in transcript but lacks external verification. In transcript-only mode, this claim cannot be verified against policy documents or system records.`,
    },
    evidence: {
      refs: evidenceRefs,
      edges: input.grounding
        .filter(g => g.claimId === claim.id)
        .map(g => ({
          kind: 'grounding' as const,
          claimA: claim.id,
          weight: g.weight || 0.7,
        })),
    },
    compliance: {
      tags: complianceTags,
      impactedPolicies: [],
      legalHoldSuggested: false,
      disclaimers,
    },
    audit: {
      createdAt: new Date().toISOString(),
      engineVersion: input.audit.engineVersion,
      scorerId: input.audit.scorerId,
      modelFingerprint: input.audit.modelFingerprint,
      configHash: input.audit.configHash,
      inputHash: input.audit.inputHash,
    },
  };
}

/**
 * Rule C: Create UNGROUNDED issue
 */
function createUngroundedClaimIssue(
  claim: Claim,
  input: IssueExpansionInput,
  evidenceQuotesMax: number
): IssueV2 | null {
  const issueKey = `ungrounded:${claim.id}`;
  const issueId = generateIssueId(input.runId, issueKey);
  
  const speaker: SpeakerV2 = 
    claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT' ? 'AGENT' :
    claim.meta?.speaker === 'Customer' || claim.meta?.speaker === 'CUSTOMER' ? 'CUSTOMER' :
    'UNKNOWN';
  
  // Compliance tags
  const complianceTags: string[] = ['missing_evidence'];
  if (claim.claimKind === 'promise') {
    complianceTags.push('commitment_risk', 'promise_tracking');
  }
  
  // Disclaimers
  const disclaimers: string[] = [
    'This claim has no grounding evidence in the transcript or external sources.',
  ];
  
  return {
    issueId,
    issueKey,
    runId: input.runId,
    conversationId: input.conversationId,
    type: 'UNGROUNDED',
    category: 'evidence',
    severity: 'medium', // Will be recomputed by ranking
    riskScore: 0, // Will be computed by ranking
    confidence: claim.confidence || 0.5,
    reviewRequired: true,
    verification: {
      level: 'NONE',
      reasonCodes: ['NO_GROUNDING_EVIDENCE'],
    },
    who: {
      speaker,
      turnIndex: claim.meta?.turnIndex,
    },
    what: {
      primaryClaimId: claim.id,
      claimText: claim.text,
      issueSummary: `Ungrounded claim: "${claim.text.substring(0, 80)}..."`,
      issueDetail: `Claim "${claim.text}" (${claim.id}) has no grounding evidence in the transcript or external sources. This claim cannot be verified or traced to any source material.`,
    },
    evidence: {
      refs: [], // No evidence refs for ungrounded claims
      edges: [],
    },
    compliance: {
      tags: complianceTags,
      impactedPolicies: [],
      legalHoldSuggested: false,
      disclaimers,
    },
    audit: {
      createdAt: new Date().toISOString(),
      engineVersion: input.audit.engineVersion,
      scorerId: input.audit.scorerId,
      modelFingerprint: input.audit.modelFingerprint,
      configHash: input.audit.configHash,
      inputHash: input.audit.inputHash,
    },
  };
}

/**
 * Rule D: Detect risk signals in a claim
 */
function detectRiskSignals(claim: Claim): string[] {
  const signals: string[] = [];
  const text = claim.text.toLowerCase();
  
  // Money/fees
  if (/\$[\d,]+|\d+\s*(dollars?|cents?)/.test(text) || 
      /\b(fee|fees|charge|charges|cost|costs|price|payment|billing|bill)\b/.test(text)) {
    signals.push('MONEY_FEES');
  }
  
  // Cancellation/termination
  if (/\b(cancel|cancellation|terminate|termination)\b/.test(text)) {
    signals.push('CANCELLATION');
  }
  
  // Refunds/credits
  if (/\b(refund|credit|reimburse)\b/.test(text)) {
    signals.push('REFUND');
  }
  
  // Legal/regulatory threats
  if (/\b(legal|lawyer|attorney|sue|lawsuit|complaint|regulatory|fcc|ftc)\b/.test(text)) {
    signals.push('LEGAL_ESCALATION');
  }
  
  // Contract terms
  if (/\b(contract|agreement|terms|policy|violation|breach)\b/.test(text)) {
    signals.push('CONTRACT_TERMS');
  }
  
  return signals;
}

/**
 * Rule D: Create RISK_SIGNAL issue
 */
function createRiskSignalIssue(
  claim: Claim,
  input: IssueExpansionInput,
  riskSignals: string[],
  evidenceQuotesMax: number
): IssueV2 | null {
  // Create one issue per signal type (or combine if multiple)
  const signalKey = riskSignals.sort().join('_');
  const issueKey = `risk_signal:${signalKey}:${claim.id}`;
  const issueId = generateIssueId(input.runId, issueKey);
  
  // Extract evidence refs (transcript quotes, limited by config)
  const evidenceRefs = (claim.evidenceRefs || []).slice(0, evidenceQuotesMax).map(ref => ({
    sourceType: 'TRANSCRIPT' as const,
    sourceId: ref.sourceId || `e-transcript-${ref.turnIndex || 0}`,
    quote: ref.quote || claim.text,
    weight: ref.weight,
    turnIndex: ref.turnIndex,
  }));
  
  const speaker: SpeakerV2 = 
    claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT' ? 'AGENT' :
    claim.meta?.speaker === 'Customer' || claim.meta?.speaker === 'CUSTOMER' ? 'CUSTOMER' :
    'UNKNOWN';
  
  // Determine category based on signals
  let category: IssueCategoryV2 = 'compliance';
  if (riskSignals.includes('MONEY_FEES')) {
    category = 'billing';
  } else if (riskSignals.includes('CANCELLATION') || riskSignals.includes('REFUND')) {
    category = 'compliance';
  } else if (riskSignals.includes('LEGAL_ESCALATION')) {
    category = 'compliance';
  }
  
  // Compliance tags
  const complianceTags: string[] = ['high_impact', ...riskSignals.map(s => s.toLowerCase())];
  
  // Disclaimers
  const disclaimers: string[] = [];
  if (input.evidenceMode === 'TRANSCRIPT_ONLY') {
    disclaimers.push('This finding is grounded in transcript content only and is not externally verified.');
  }
  
  return {
    issueId,
    issueKey,
    runId: input.runId,
    conversationId: input.conversationId,
    type: 'RISK_SIGNAL',
    category,
    severity: 'high', // Will be recomputed by ranking
    riskScore: 0, // Will be computed by ranking
    confidence: claim.confidence || 0.7,
    reviewRequired: true,
    verification: {
      level: input.evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL' ? 'EXTERNAL_VERIFIED' : 'TRANSCRIPT_ONLY',
      reasonCodes: input.evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
    },
    who: {
      speaker,
      turnIndex: claim.meta?.turnIndex,
    },
    what: {
      primaryClaimId: claim.id,
      claimText: claim.text,
      issueSummary: `High-risk signal detected: ${riskSignals.join(', ')} in "${claim.text.substring(0, 60)}..."`,
      issueDetail: `Claim "${claim.text}" (${claim.id}) contains high-risk signals: ${riskSignals.join(', ')}. This may indicate financial impact, legal escalation risk, or policy violations.`,
    },
    evidence: {
      refs: evidenceRefs,
      edges: input.grounding
        .filter(g => g.claimId === claim.id)
        .map(g => ({
          kind: 'grounding' as const,
          claimA: claim.id,
          weight: g.weight || 0.7,
        })),
    },
    compliance: {
      tags: complianceTags,
      impactedPolicies: [],
      legalHoldSuggested: true, // Risk signals suggest legal hold
      disclaimers,
    },
    audit: {
      createdAt: new Date().toISOString(),
      engineVersion: input.audit.engineVersion,
      scorerId: input.audit.scorerId,
      modelFingerprint: input.audit.modelFingerprint,
      configHash: input.audit.configHash,
      inputHash: input.audit.inputHash,
    },
  };
}

/**
 * Generate stable issue ID from runId + issueKey
 */
function generateIssueId(runId: string, issueKey: string): string {
  const hash = createHash('sha256')
    .update(`${runId}:${issueKey}`)
    .digest('hex')
    .substring(0, 16);
  return `issue_${hash}`;
}

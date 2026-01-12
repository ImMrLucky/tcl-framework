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
import { deriveIssueSpeaker, speakerTypeToRole } from '../graph/transcript-normalizer.js';

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
  
  // Debug logging
  console.log('🔍 ISSUE EXPANSION DEBUG:', {
    totalClaims: input.claims.length,
    contradictions: input.contradictions.length,
    supports: input.supports.length,
    grounding: input.grounding.length,
    groundedClaimIds: groundedClaimIds.size,
    contradictedClaimIds: contradictedClaimIds.size,
    evidenceMode: input.evidenceMode,
    claimsWithClaimKind: input.claims.filter(c => c.claimKind).length,
    claimsWithTruthState: input.claims.filter(c => c.truthState).length,
    agentClaims: input.claims.filter(c => c.meta?.speaker === 'Agent' || c.meta?.speaker === 'AGENT').length,
  });
  
  // Rule A: Contradiction edges → CONTRADICTION issues
  let contradictionIssues = 0;
  for (const edge of input.contradictions) {
    const issue = createContradictionIssue(edge, claimMap, input, evidenceQuotesMax);
    if (issue && !issueKeys.has(issue.issueKey)) {
      issues.push(issue);
      issueKeys.add(issue.issueKey);
      contradictionIssues++;
    }
  }
  console.log(`  ✅ Rule A (Contradictions): ${contradictionIssues} issues`);
  
  // Rule B: Unverified claims → UNVERIFIED_CLAIM issues
  // Only in transcript-only mode, and only for agent assertions/promises
  let unverifiedIssues = 0;
  if (input.evidenceMode === 'TRANSCRIPT_ONLY') {
    for (const claim of input.claims) {
      const truthState = claim.truthState?.toUpperCase();
      const isUnverified = truthState === 'UNVERIFIED' || truthState === 'UNVERIFIED_CLAIM';
      const hasGrounding = groundedClaimIds.has(claim.id) || (claim.evidenceRefs?.length ?? 0) > 0;
  
      // Determine verification level (we're in TRANSCRIPT_ONLY mode, so it's either TRANSCRIPT_ONLY or NONE)
      let verificationLevel: VerificationLevelV2 = hasGrounding ? 'TRANSCRIPT_ONLY' : 'NONE';
      const isAgent = claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT';
      
      // More lenient: if claimKind is not set, assume it's an assertion if it's from an agent
      // (agents typically make assertions/promises, not questions or emotions)
      const isAssertionOrPromise = claim.claimKind === 'assertion' || 
                                   claim.claimKind === 'promise' ||
                                   (!claim.claimKind && isAgent); // Fallback: agent claims are likely assertions
      
      // Only flag agent assertions/promises that are unverified
      // Skip if already contradicted (handled by Rule A)
      if (isUnverified && hasGrounding && isAgent && isAssertionOrPromise && !contradictedClaimIds.has(claim.id)) {
        const issue = createUnverifiedClaimIssue(claim, input, evidenceQuotesMax);
        if (issue && !issueKeys.has(issue.issueKey)) {
          issues.push(issue);
          issueKeys.add(issue.issueKey);
          unverifiedIssues++;
        }
      }
    }
  }
  console.log(`  ✅ Rule B (Unverified): ${unverifiedIssues} issues`);
  
  // Rule C: Ungrounded claims → UNGROUNDED issues
  // Claims with no grounding edges at all
  let ungroundedIssues = 0;
  for (const claim of input.claims) {
    const truthState = claim.truthState?.toUpperCase();
    const isUngrounded = truthState === 'UNGROUNDED' || 
                         (!groundedClaimIds.has(claim.id) && (claim.evidenceRefs?.length ?? 0) === 0);
    const isAgent = claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT';
    
    // More lenient: if claimKind is not set, assume it's an assertion if it's from an agent
    const isAssertionOrPromise = claim.claimKind === 'assertion' || 
                                 claim.claimKind === 'promise' ||
                                 (!claim.claimKind && isAgent); // Fallback: agent claims are likely assertions
    
    // Only flag agent assertions/promises that are ungrounded
    // Skip if already contradicted or unverified (handled by Rules A & B)
    if (isUngrounded && isAgent && isAssertionOrPromise && 
        !contradictedClaimIds.has(claim.id) && 
        !issueKeys.has(`unverified:${claim.id}`)) {
      const issue = createUngroundedClaimIssue(claim, input, evidenceQuotesMax);
      if (issue && !issueKeys.has(issue.issueKey)) {
        issues.push(issue);
        issueKeys.add(issue.issueKey);
        ungroundedIssues++;
      }
    }
  }
  console.log(`  ✅ Rule C (Ungrounded): ${ungroundedIssues} issues`);
  
  // Rule D: Risk signals → RISK_SIGNAL issues
  // High-impact assertions: money, fees, cancellation, refund promises, legal threats
  let riskSignalIssues = 0;
  for (const claim of input.claims) {
    const isAgent = claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT';
    
    // More lenient: if claimKind is not set, assume it's an assertion if it's from an agent
    const isAssertionOrPromise = claim.claimKind === 'assertion' || 
                                 claim.claimKind === 'promise' ||
                                 (!claim.claimKind && isAgent); // Fallback: agent claims are likely assertions
    
    if (isAgent && isAssertionOrPromise) {
      const riskSignals = detectRiskSignals(claim);
      if (riskSignals.length > 0 && !contradictedClaimIds.has(claim.id)) {
        const issue = createRiskSignalIssue(claim, input, riskSignals, evidenceQuotesMax);
        if (issue && !issueKeys.has(issue.issueKey)) {
          issues.push(issue);
          issueKeys.add(issue.issueKey);
          riskSignalIssues++;
        }
      }
    }
  }
  console.log(`  ✅ Rule D (Risk Signals): ${riskSignalIssues} issues`);
  
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
  
  console.log(`  ✅ TOTAL ISSUES GENERATED: ${issues.length} (by type: ${Object.entries(issues.reduce((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([k, v]) => `${k}=${v}`).join(', ')})`);
  console.log(`  ✅ ISSUES BY CLAIM: ${Object.keys(issuesByClaim).length} claims have issues`);
  
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
  
  // B3: Derive issue speaker from claims using new speaker info structure
  const claimSpeakers = [
    {
      speakerType: claimA.meta?.speakerType || (claimA.meta?.speaker === 'Agent' || claimA.meta?.speaker === 'AGENT' ? 'agent' : 
                                                 claimA.meta?.speaker === 'Customer' || claimA.meta?.speaker === 'CUSTOMER' ? 'customer' : 'unknown'),
      speakerLabel: claimA.meta?.speakerLabel,
    },
    {
      speakerType: claimB.meta?.speakerType || (claimB.meta?.speaker === 'Agent' || claimB.meta?.speaker === 'AGENT' ? 'agent' : 
                                                 claimB.meta?.speaker === 'Customer' || claimB.meta?.speaker === 'CUSTOMER' ? 'customer' : 'unknown'),
      speakerLabel: claimB.meta?.speakerLabel,
    },
  ];
  
  const issueSpeaker = deriveIssueSpeaker(claimSpeakers);
  const speaker: SpeakerV2 = issueSpeaker.speaker;
  const speakerLabel = issueSpeaker.speakerLabel;
  
  // B2: Speaker gating - determine if this is AGENT↔AGENT (normal) vs customer dispute
  const isAgentAgent = claimSpeakers[0].speakerType === 'agent' && claimSpeakers[1].speakerType === 'agent';
  const speakerType = isAgentAgent ? 'agent' : 'mixed';
  
  const turnIndex = claimA.meta?.turnIndex ?? claimB.meta?.turnIndex;
  
  // Extract topicId and slotKey for clustering (C1)
  // Note: topicId and slot are not on Claim type, but may be in edge rationale or claim metadata
  // For now, use a fallback based on claim text or edge info
  const topicId = (edge as any).topicId || (claimA as any).topicId || (claimB as any).topicId || 'unknown';
  const slotType = (edge as any).slotType || (claimA as any).slot?.slotType || (claimB as any).slot?.slotType || 'unknown';
  const entityKey = (edge as any).entityKey || (claimA as any).slot?.entityKey || (claimB as any).slot?.entityKey || '';
  const slotKey = `${slotType}:${entityKey}`;
  
  // C1: Generate clusterKey for aggregation
  const clusterKey = `${'consistency'}:${'CONTRADICTION'}:${topicId}:${slotKey}:${speakerType}`;
  const clusterId = createHash('sha256').update(clusterKey).digest('hex').substring(0, 16);
  
  // 3.1: Fix verification logic - distinguish transcript grounding from external support
  // Compute external verification from SUPPORT edges to non-transcript evidence
  // A2: Define TRANSCRIPT_ONLY correctly (no more accidental NONE)
  // TRANSCRIPT_ONLY if any of these are true:
  // - claim has meta.turnIndex, span, or provenance anchors
  // - claim has transcript grounding edges
  // - claim has transcript evidence refs (to transcript EvidenceNodes)
  // NONE only if:
  // - claim has no transcript anchors/spans/turnIndex AND no grounding edges AND no evidence refs
  
  const hasTranscriptGrounding = input.grounding.some(g => g.claimId === edge.claimA || g.claimId === edge.claimB);
  const hasTranscriptRefs = evidenceRefs.some(ref => ref.sourceId.startsWith('e-transcript-'));
  const hasTurnIndex = (claimA.meta?.turnIndex !== undefined) || (claimB.meta?.turnIndex !== undefined);
  const hasSpan = (claimA as any).span || (claimB as any).span;
  
  // Check for external support (support edges to non-transcript evidence)
  const hasExternalSupport = input.supports.some(s => {
    const involvesClaim = s.claimA === edge.claimA || s.claimB === edge.claimA || 
                          s.claimA === edge.claimB || s.claimB === edge.claimB;
    if (!involvesClaim) return false;
    
    // Check if support is to external evidence (not transcript)
    const evidenceId = (s as any).evidenceId || (s as any).targetId;
    if (evidenceId && !evidenceId.startsWith('e-transcript-')) {
      return true; // External evidence support
    }
    
    // Also check if support edge has evidenceKind that's not transcript
    const evidenceKind = (s as any).evidenceKind;
    if (evidenceKind && evidenceKind !== 'transcript') {
      return true; // External evidence support
    }
    
    return false;
  });
  
  // A1: Expand verification levels (canonical)
  let verificationLevel: VerificationLevelV2;
  if (hasExternalSupport) {
    verificationLevel = 'EXTERNAL_VERIFIED'; // A1: Grounded to org/per-ingestion docs/policies
  } else if (hasTranscriptGrounding || hasTranscriptRefs || hasTurnIndex || hasSpan) {
    verificationLevel = 'TRANSCRIPT_ONLY'; // A2: Grounded to transcript turns/spans (traceable)
  } else {
    verificationLevel = 'NONE'; // A1: Only when truly cannot trace (should be rare)
  }
  
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
    clusterKey,
    clusterId,
    topicId,
    slotKey,
    runId: input.runId,
    conversationId: input.conversationId,
    type: 'CONTRADICTION',
    category: 'consistency',
    severity: 'medium', // Will be recomputed by ranking
    impact: 'high' as const, // Contradictions are high impact
    riskScore: 0, // Will be computed by ranking
    score: 0, // Will be computed by scoring
    // 5.1: Ensure confidence is always populated from real signals
    // For contradictions: use edge weight (already 0..1)
    // Fallback to claim confidence metrics if edge weight missing
    confidence: edge.weight ?? 
                 (claimA as any).confidenceMetrics?.groundingScore ?? 
                 claimA.confidence ?? 
                 0.6, // Last resort: reasonable default (not 0.5 to avoid plateaus)
    reviewRequired: true,
    // B2: Store speaker gating info for scoring
    // @ts-ignore - temporary field for speaker gating
    _speakerGating: {
      isAgentAgent,
      speakerType,
    },
    verification: {
      level: verificationLevel,
      reasonCodes: input.evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
    },
    who: {
      speaker,
      speakerLabel: speakerLabel,
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
        weight: edge.weight, // Use actual edge weight (no fallback - let scoring handle missing)
      }],
      // D1: Always populate evidence.verification
      verification: {
        level: verificationLevel,
        reasonCodes: input.evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
        provenance: {
          transcriptAnchors: [
            ...(claimA.meta?.turnIndex !== undefined ? [{ turnIndex: claimA.meta.turnIndex, claimId: edge.claimA }] : []),
            ...(claimB.meta?.turnIndex !== undefined ? [{ turnIndex: claimB.meta.turnIndex, claimId: edge.claimB }] : []),
          ],
          externalDocRefs: hasExternalSupport ? evidenceRefs.filter(r => !r.sourceId.startsWith('e-transcript-')).map(r => r.sourceId) : [],
        },
      },
    },
    compliance: {
      tags: complianceTags,
      impactedPolicies: [], // Empty in transcript-only
      legalHoldSuggested: false, // Will be recomputed by ranking
      disclaimers,
    },
    scoring: createDefaultScoring(),
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
  
  // B3: Derive speaker from claim using new speaker info structure
  const speakerType = claim.meta?.speakerType || 
    (claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT' ? 'agent' : 
     claim.meta?.speaker === 'Customer' || claim.meta?.speaker === 'CUSTOMER' ? 'customer' : 'unknown');
  const speaker: SpeakerV2 = speakerTypeToRole(speakerType);
  const speakerLabel = claim.meta?.speakerLabel;
  
  // Compliance tags
  const complianceTags: string[] = [];
  if (claim.claimKind === 'promise') {
    complianceTags.push('commitment_risk', 'promise_tracking');
  }
  if (claim.text.toLowerCase().includes('fee') || claim.text.toLowerCase().includes('charge')) {
    complianceTags.push('fee_disclosure');
  }
  
  // Determine verification level based on evidence mode and actual grounding
  const hasGrounding = evidenceRefs.length > 0 || input.grounding.some(g => g.claimId === claim.id);
  let verificationLevel: VerificationLevelV2 = 'NONE';
  if (input.evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL' && hasGrounding) {
    verificationLevel = 'EXTERNAL_VERIFIED';
  } else if (input.evidenceMode === 'TRANSCRIPT_ONLY' && hasGrounding) {
    verificationLevel = 'TRANSCRIPT_ONLY';
  } else {
    verificationLevel = 'NONE';
  }
  
  // Store verificationLevel for use in evidence.verification below
  const finalVerificationLevel = verificationLevel;
  
  // Disclaimers
  const disclaimers: string[] = [];
  if (verificationLevel === 'TRANSCRIPT_ONLY') {
    disclaimers.push('This finding is grounded in transcript content only and is not externally verified.');
  } else if (verificationLevel === 'NONE') {
    disclaimers.push('This finding has no grounding evidence.');
  }
  
  return {
    issueId,
    issueKey,
    runId: input.runId,
    conversationId: input.conversationId,
    type: 'UNVERIFIED_CLAIM',
    category: 'evidence',
    severity: 'low', // Will be recomputed by ranking
    impact: 'low' as const, // Unverified claims are low impact
    riskScore: 0, // Will be computed by ranking
    score: 0, // Will be computed by scoring
    // 5.1: Ensure confidence is always populated from real signals
    confidence: claim.confidence ?? 
                 (claim as any).confidenceMetrics?.groundingScore ?? 
                 0.6, // Last resort: reasonable default
    reviewRequired: true, // Agent assertions/promises require review
    verification: {
      level: verificationLevel,
      reasonCodes: verificationLevel === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : 
                   verificationLevel === 'NONE' ? ['NO_GROUNDING'] : [],
    },
    who: {
      speaker,
      speakerLabel: speakerLabel,
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
      // D1: Always populate evidence.verification
      verification: {
        level: verificationLevel,
        reasonCodes: verificationLevel === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : 
                     verificationLevel === 'NONE' ? ['NO_GROUNDING'] : [],
        provenance: {
          transcriptAnchors: claim.meta?.turnIndex !== undefined ? [{ turnIndex: claim.meta.turnIndex, claimId: claim.id }] : [],
          externalDocRefs: [],
        },
      },
    },
    compliance: {
      tags: complianceTags,
      impactedPolicies: [],
      legalHoldSuggested: false,
      disclaimers,
    },
    scoring: createDefaultScoring(),
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
  
  // B3: Derive speaker from claim using new speaker info structure
  const speakerType = claim.meta?.speakerType || 
    (claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT' ? 'agent' : 
     claim.meta?.speaker === 'Customer' || claim.meta?.speaker === 'CUSTOMER' ? 'customer' : 'unknown');
  const speaker: SpeakerV2 = speakerTypeToRole(speakerType);
  const speakerLabel = claim.meta?.speakerLabel;
  
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
    impact: 'low' as const, // Ungrounded claims are low impact
    riskScore: 0, // Will be computed by ranking
    score: 0, // Will be computed by scoring
    // 5.1: Ensure confidence is always populated from real signals
    confidence: claim.confidence ?? 
                 (claim as any).confidenceMetrics?.groundingScore ?? 
                 0.6, // Last resort: reasonable default
    reviewRequired: true,
    verification: {
      level: 'NONE',
      reasonCodes: ['NO_GROUNDING_EVIDENCE'],
    },
    who: {
      speaker,
      speakerLabel: speakerLabel,
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
      // D1: Always populate evidence.verification
      verification: {
        level: 'NONE',
        reasonCodes: ['NO_GROUNDING_EVIDENCE'],
        provenance: {
          transcriptAnchors: [],
          externalDocRefs: [],
        },
      },
    },
    compliance: {
      tags: complianceTags,
      impactedPolicies: [],
      legalHoldSuggested: false,
      disclaimers,
    },
    scoring: createDefaultScoring(),
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
  
  // B3: Derive speaker from claim using new speaker info structure
  const speakerType = claim.meta?.speakerType || 
    (claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT' ? 'agent' : 
     claim.meta?.speaker === 'Customer' || claim.meta?.speaker === 'CUSTOMER' ? 'customer' : 'unknown');
  const speaker: SpeakerV2 = speakerTypeToRole(speakerType);
  const speakerLabel = claim.meta?.speakerLabel;
  
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
  
  // Determine verification level
  const hasGrounding = evidenceRefs.length > 0 || input.grounding.some(g => g.claimId === claim.id);
  let verificationLevel: VerificationLevelV2 = 'NONE';
  if (input.evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL' && hasGrounding) {
    verificationLevel = 'EXTERNAL_VERIFIED';
  } else if (input.evidenceMode === 'TRANSCRIPT_ONLY' && hasGrounding) {
    verificationLevel = 'TRANSCRIPT_ONLY';
  } else {
    verificationLevel = 'NONE';
  }
  
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
    impact: 'high' as const, // Risk signals are high impact
    riskScore: 0, // Will be computed by ranking
    score: 0, // Will be computed by scoring
    // 5.1: Ensure confidence is always populated from real signals
    confidence: claim.confidence ?? 
                 (claim as any).confidenceMetrics?.groundingScore ?? 
                 0.6, // Last resort: reasonable default
    reviewRequired: true,
    verification: {
      level: verificationLevel,
      reasonCodes: verificationLevel === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : 
                   verificationLevel === 'NONE' ? ['NO_GROUNDING'] : [],
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
      // D1: Always populate evidence.verification
      verification: {
        level: verificationLevel,
        reasonCodes: verificationLevel === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : 
                     verificationLevel === 'NONE' ? ['NO_GROUNDING'] : [],
        provenance: {
          transcriptAnchors: claim.meta?.turnIndex !== undefined ? [{ turnIndex: claim.meta.turnIndex, claimId: claim.id }] : [],
          externalDocRefs: [],
        },
      },
    },
    compliance: {
      tags: complianceTags,
      impactedPolicies: [],
      legalHoldSuggested: true, // Risk signals suggest legal hold
      disclaimers,
    },
    scoring: createDefaultScoring(),
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
 * Generate stable issue ID
 * 
 * Formula: hash(templateId + topicId + sortedClaimIds + issueType)
 * For backwards compatibility, if templateId/topicId not available, use runId + issueKey
 */
function generateIssueId(
  runId: string,
  issueKey: string,
  templateId?: string,
  topicId?: string,
  claimIds?: string[],
  issueType?: string
): string {
  // Use templateId + topicId + sortedClaimIds + issueType if available (V3 contract)
  if (templateId && topicId && claimIds && issueType) {
    const sortedClaimIds = [...claimIds].sort().join(',');
    const stableKey = `${templateId}:${topicId}:${sortedClaimIds}:${issueType}`;
    const hash = createHash('sha256')
      .update(stableKey)
      .digest('hex')
      .substring(0, 16);
    return `issue_${hash}`;
  }

  // Fallback to runId + issueKey (backwards compatibility)
  const hash = createHash('sha256')
    .update(`${runId}:${issueKey}`)
    .digest('hex')
    .substring(0, 16);
  return `issue_${hash}`;
}

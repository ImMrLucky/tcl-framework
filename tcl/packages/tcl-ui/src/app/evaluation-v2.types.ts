/**
 * F1: V2-only TypeScript models
 * 
 * Canonical v2 API response types with no legacy fields.
 * These types match the backend EvaluationV2Dto exactly.
 */

export interface EvaluationResponseV2 {
  evaluation: EvaluationV2;
}

export interface EvaluationV2 {
  id: string;
  org_id: string;
  project_id: string;
  env: string;
  conversation_id: string | null;
  scores: {
    truth?: number;
    overall?: number;
    coherence?: number;
    consistency?: number;
    spectral?: {
      coherenceScore?: number;
      contradictionEnergy?: number;
      supportEnergy?: number;
      circularityScore?: number;
      spectralGap?: number;
      cycleMass?: number;
      heatTrace?: number;
    };
    counts?: {
      claims?: number;
      contradicted?: number;
      ungrounded?: number;
      supported?: number;
    };
  };
  refusal: boolean;
  scorer_id: string | null;
  engine_version: string;
  latency_ms: number;
  created_at: string;
  
  report?: EvaluationReportV2;
}

export interface EvaluationReportV2 {
  issues?: {
    atomic: IssueV2[];
    grouped: GroupedIssueV2[];
  };
  topIssuesV2?: GroupedIssueV2[];
  allIssuesV2?: IssueV2[];
  issueSummaryV2?: IssueSummaryV2;
  claims?: any[];
  graph?: {
    contradictions?: any[];
    supports?: any[];
  };
  spectral?: any;
  executiveSummary?: any;
  evalMode?: any;
}

export interface IssueV2 {
  issueId: string;
  issueKey: string;
  clusterKey?: string;
  clusterId?: string;
  topicId?: string;
  slotKey?: string;
  runId: string;
  conversationId: string;
  
  type: string;
  category: string; // Legacy category
  primaryCategory?: 'compliance' | 'privacy_security' | 'billing_financial' | 'promises_consistency' | 'policy_process' | 'customer_dispute'; // NEW: Canonical category
  severity: 'low' | 'medium' | 'high' | 'critical';
  severityDisplay?: 'low' | 'medium' | 'high' | 'critical'; // Display version
  impact: 'low' | 'medium' | 'high';
  riskScore: number;
  score: number;
  confidence: number;
  reviewRequired: boolean;
  
  verification: {
    level: 'TRANSCRIPT_PROVABLE' | 'DOC_SUPPORTED' | 'SYSTEM_VERIFIED' | 'EXTERNAL_VERIFIED' | 'TRANSCRIPT_ONLY' | 'UNVERIFIED' | 'NONE';
    reasonCodes: string[];
    provenance?: {
      transcriptAnchors: Array<{
        turnIndex: number;
        claimId: string;
        excerpt?: string;
        start?: number;
        end?: number;
      }>;
      evidenceDocRefs: Array<{
        docId: string;
        chunkId?: string;
        snippet: string;
        score: number;
        sourceType: string;
        version: string;
        sha256: string;
      }>;
    };
  };
  
  scoring: {
    components: {
      impact01: number;
      evidence01: number;
      signal01: number;
      category01: number;
      verificationMultiplier: number;
      risk01Raw: number;
      risk01Final: number;
    };
    weights: {
      impact: number;
      evidence: number;
      signal: number;
      category: number;
    };
    reasons: string[];
    modeCapsApplied?: string[];
  };
  
  who: {
    speaker: string;
    speakerLabel?: string;
    turnIndex?: number;
  };
  
  what: {
    primaryClaimId: string;
    relatedClaimIds?: string[];
    claimText?: string;
    issueSummary: string;
    issueDetail: string;
  };
  
  evidence: {
    // Legacy refs (for backward compatibility)
    refs?: Array<{
      sourceType: string;
      sourceId: string;
      quote: string;
      weight?: number;
      turnIndex?: number;
    }>;
    // NEW: Evidence citations
    evidenceRefs?: Array<{
      docId: string;
      chunkId?: string;
      snippet: string;
      offsets?: { start: number; end: number };
      score: number;
      sourceType: string;
      version: string;
      sha256: string;
      title?: string;
    }>;
    edges?: Array<{
      kind: string;
      claimA: string;
      claimB?: string;
      weight: number;
    }>;
    verification?: {
      level: string;
      reasonCodes: string[];
      provenance?: {
        transcriptAnchors: Array<{ turnIndex: number; claimId: string }>;
        externalDocRefs: string[];
      };
    };
  };
  
  // NEW: Transcript spans for traceability
  transcriptSpans?: Array<{
    turnIndex: number;
    speaker: string;
    speakerLabel?: string;
    excerpt: string;
    start?: number;
    end?: number;
  }>;
  
  compliance: {
    tags: string[];
    impactedPolicies?: Array<{ policyId: string; section?: string }>;
    legalHoldSuggested?: boolean;
    disclaimers: string[];
  };
  
  audit: {
    createdAt: string;
    engineVersion: string;
    scorerId: string;
    modelFingerprint?: any;
    configHash?: string;
    inputHash?: string;
  };
}

export interface GroupedIssueV2 {
  clusterId: string;
  clusterKey: string;
  category: string;
  type: string;
  topicId?: string;
  slotKey?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  score: number;
  confidence: number;
  impact: 'low' | 'medium' | 'high';
  reviewRequired: boolean;
  verification: {
    level: string;
    reasonCodes?: string[];
  };
  what: {
    issueSummary: string;
    issueDetail?: string;
    representativeClaimText?: string;
    primaryClaimId?: string;
    relatedClaimIds?: string[];
  };
  rollup: {
    atomicIssueCount: number;
    atomicIssueIds: string[];
    issueKeys: string[];
    involvedClaimIds: string[];
    involvedTurnIndexes: number[];
    topEdges?: Array<{
      kind: string;
      claimA?: string;
      claimB?: string;
      weight?: number;
    }>;
    refs?: Array<{
      quote?: string;
      sourceId?: string;
      sourceType?: string;
      turnIndex?: number;
    }>;
  };
  audit: {
    scorerId: string;
    createdAt: string;
    engineVersion: string;
    inputHash?: string;
    configHash?: string;
  };
}

export interface IssueSummaryV2 {
  totalIssues: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  topIssuesCount: number;
  allIssuesCount: number;
}


import { createHash } from "crypto";
import type { Claim, SpectralReport, ValidateOutput } from "../../types.js";

/**
 * Canonicalize and hash the input payload (claims + edges + grounded)
 */
export function computeInputHash(
  claims: Array<{ id: string; text: string }>,
  supports: Array<{ claimA: string; claimB: string; weight?: number }>,
  contradictions: Array<{ claimA: string; claimB: string; weight?: number }>,
  grounded: string[]
): string {
  // Sort claims by id for stable ordering
  const sortedClaims = [...claims].sort((a, b) => a.id.localeCompare(b.id));
  
  // Sort edges by (claimA, claimB, weight) for stable ordering
  const sortedSupports = [...supports].sort((a, b) => {
    if (a.claimA !== b.claimA) return a.claimA.localeCompare(b.claimA);
    if (a.claimB !== b.claimB) return a.claimB.localeCompare(b.claimB);
    return (a.weight || 0) - (b.weight || 0);
  });
  
  const sortedContradictions = [...contradictions].sort((a, b) => {
    if (a.claimA !== b.claimA) return a.claimA.localeCompare(b.claimA);
    if (a.claimB !== b.claimB) return a.claimB.localeCompare(b.claimB);
    return (a.weight || 0) - (b.weight || 0);
  });
  
  // Sort grounded claim IDs
  const sortedGrounded = [...grounded].sort();
  
  // Create canonical JSON (stable key ordering)
  const canonical = JSON.stringify({
    claims: sortedClaims,
    supports: sortedSupports,
    contradictions: sortedContradictions,
    grounded: sortedGrounded
  });
  
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Canonicalize and hash the config
 */
export function computeConfigHash(config: {
  wSupport?: number;
  wContradiction?: number;
  wCircularity?: number;
  cycleMaxLen?: number;
  alpha?: number;
  tau?: number;
  [key: string]: any;
}): string {
  // Sort keys for stable ordering
  const sortedConfig: Record<string, any> = {};
  const keys = Object.keys(config).sort();
  for (const key of keys) {
    if (config[key] !== undefined) {
      sortedConfig[key] = config[key];
    }
  }
  
  const canonical = JSON.stringify(sortedConfig);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Get engine version from environment or default
 */
export function getEngineVersion(): string {
  return process.env.ENGINE_VERSION || '0.3.0';
}

/**
 * Get code version (git commit SHA or build version)
 */
export function getCodeVersion(): string {
  return process.env.CODE_VERSION || process.env.GIT_SHA || 'unknown';
}

/**
 * Get model fingerprint
 */
export function getModelFingerprint(): {
  claimExtractor: string;
  nliModel: string;
  embeddingModel?: string;
} {
  return {
    claimExtractor: process.env.CLAIM_EXTRACTOR_VERSION || 'v1',
    nliModel: process.env.NLI_MODEL || 'transformers@roberta-large-mnli',
    embeddingModel: process.env.EMBEDDING_MODEL
  };
}

/**
 * Calculate importance score for an issue
 */
export function calculateImportance(params: {
  nodeBlameNorm?: number;
  truthState?: "Supported" | "Contradicted" | "Ungrounded" | "Inconclusive";
  speaker?: string;
  hasPolicyTag?: boolean;
}): number {
  const { nodeBlameNorm = 0, truthState, speaker, hasPolicyTag = false } = params;
  
  // Truth state multipliers
  const truthStateMultiplier = {
    "Contradicted": 1.35,
    "Ungrounded": 1.15,
    "Inconclusive": 1.05,
    "Supported": 0.75
  }[truthState || "Inconclusive"] || 1.0;
  
  // Agent multiplier
  const agentMultiplier = speaker === "AGENT" ? 1.15 : 1.0;
  
  // Policy multiplier
  const policyMultiplier = hasPolicyTag ? 1.25 : 1.0;
  
  return nodeBlameNorm * truthStateMultiplier * agentMultiplier * policyMultiplier;
}

/**
 * Build issues list from spectral output and claims
 */
export function buildIssuesList(
  spectral: SpectralReport,
  claims: Array<Claim & { meta?: { speaker?: string; turnIndex?: number } }>,
  destructiveClaims?: Array<{ claimId: string; importance: number; [key: string]: any }>
): Array<{
  claimId: string;
  truthState: "Contradicted" | "Supported" | "Ungrounded" | "Inconclusive";
  nodeBlameNorm: number;
  importance: number;
  issueType: "CONTRADICTION" | "UNSUPPORTED" | "POLICY_MISS" | "POLICY_VIOLATION";
  speaker: "AGENT" | "CUSTOMER" | "UNKNOWN";
  turnStartIdx?: number;
  turnEndIdx?: number;
  primaryEvidence?: {
    turnIdx: number;
    speaker: string;
    excerpt: string;
  };
  relatedEdges: {
    topBadContradictions: any[];
    topBadSupports: any[];
  };
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "FALSE_POSITIVE";
}> {
  const issues: any[] = [];
  const claimMap = new Map(claims.map(c => [c.id, c]));
  
  // Use destructive claims if available, otherwise derive from spectral
  if (destructiveClaims && destructiveClaims.length > 0) {
    for (const dc of destructiveClaims) {
      const claim = claimMap.get(dc.claimId);
      if (!claim) continue;
      
      const truthState = dc.truthState || "Inconclusive";
      const nodeBlameNorm = dc.nodeBlameNorm || 0;
      const speaker = claim.meta?.speaker === "Agent" ? "AGENT" : 
                     claim.meta?.speaker === "Customer" ? "CUSTOMER" : "UNKNOWN";
      
      // Determine issue type
      let issueType: "CONTRADICTION" | "UNSUPPORTED" | "POLICY_MISS" | "POLICY_VIOLATION" = "UNSUPPORTED";
      if (truthState === "Contradicted") {
        issueType = "CONTRADICTION";
      } else if (dc.policyRuleIds && dc.policyRuleIds.length > 0) {
        issueType = dc.policySeverity === "error" ? "POLICY_VIOLATION" : "POLICY_MISS";
      }
      
      // Find related edges from spectral
      const topBadContradictions = spectral.topBadContradictions?.filter(
        e => e.claimAId === dc.claimId || e.claimBId === dc.claimId
      ) || [];
      const topBadSupports = spectral.topBadSupports?.filter(
        e => e.claimAId === dc.claimId || e.claimBId === dc.claimId
      ) || [];
      
      issues.push({
        claimId: dc.claimId,
        truthState,
        nodeBlameNorm,
        importance: dc.importance,
        issueType,
        speaker,
        turnStartIdx: claim.meta?.turnIndex,
        turnEndIdx: claim.meta?.turnIndex,
        primaryEvidence: claim.meta?.turnIndex !== undefined ? {
          turnIdx: claim.meta.turnIndex,
          speaker,
          excerpt: claim.text.substring(0, 200) // First 200 chars as excerpt
        } : undefined,
        relatedEdges: {
          topBadContradictions,
          topBadSupports
        },
        status: "OPEN" as const
      });
    }
  } else {
    // Fallback: derive from spectral truthVector and nodeBlame
    const truthStates = spectral.truthStates || [];
    const nodeBlameNorm = spectral.nodeBlameNorm || [];
    
    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i];
      const truthState = (truthStates[i] || "Inconclusive") as any;
      const blame = nodeBlameNorm[i] || 0;
      
      if (blame > 0.1 || truthState === "Contradicted" || truthState === "Ungrounded") {
        const speaker = claim.meta?.speaker === "Agent" ? "AGENT" : 
                       claim.meta?.speaker === "Customer" ? "CUSTOMER" : "UNKNOWN";
        
        const importance = calculateImportance({
          nodeBlameNorm: blame,
          truthState,
          speaker
        });
        
        issues.push({
          claimId: claim.id,
          truthState,
          nodeBlameNorm: blame,
          importance,
          issueType: truthState === "Contradicted" ? "CONTRADICTION" : "UNSUPPORTED",
          speaker,
          turnStartIdx: claim.meta?.turnIndex,
          turnEndIdx: claim.meta?.turnIndex,
          primaryEvidence: claim.meta?.turnIndex !== undefined ? {
            turnIdx: claim.meta.turnIndex,
            speaker,
            excerpt: claim.text.substring(0, 200)
          } : undefined,
          relatedEdges: {
            topBadContradictions: spectral.topBadContradictions?.filter(
              e => e.claimAId === claim.id || e.claimBId === claim.id
            ) || [],
            topBadSupports: spectral.topBadSupports?.filter(
              e => e.claimAId === claim.id || e.claimBId === claim.id
            ) || []
          },
          status: "OPEN" as const
        });
      }
    }
  }
  
  // Sort by importance descending
  issues.sort((a, b) => b.importance - a.importance);
  
  return issues;
}


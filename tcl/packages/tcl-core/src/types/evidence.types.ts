/**
 * Evidence System Types
 * Part of ProtectQA Evidence/Policy System + Categories & "View By" Ordering
 */

// ============================================================================
// EVIDENCE SCOPES
// ============================================================================

export type EvidenceScope = 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION';

// ============================================================================
// EVIDENCE SOURCE TYPES
// ============================================================================

export type EvidenceSourceType =
  | 'POLICY'
  | 'RULESET'
  | 'KNOWLEDGE'
  | 'ACCOUNT_FACTS'
  | 'LEGAL'
  | 'URL_LINK'
  | 'SYSTEM_EXPORT';

// ============================================================================
// EVIDENCE STORAGE KINDS
// ============================================================================

export type EvidenceStorageKind = 'FILE' | 'LINK';

// ============================================================================
// EVIDENCE STATUS
// ============================================================================

export type EvidenceStatus = 'DRAFT' | 'APPROVED' | 'DEPRECATED';

// ============================================================================
// EVIDENCE INDEXING STATUS
// ============================================================================

export type EvidenceIndexStatus = 'PENDING' | 'INDEXED' | 'FAILED';

// ============================================================================
// EVIDENCE ITEM
// ============================================================================

export interface EvidenceItem {
  id: string;
  orgId: string;
  projectId?: string;
  conversationId?: string;
  templateId?: string;
  
  scope: EvidenceScope;
  sourceType: EvidenceSourceType;
  
  title: string;
  description?: string;
  tags: string[];
  regions?: string[]; // jurisdiction/regions this applies to
  
  storageKind: EvidenceStorageKind;
  
  // File storage (if storageKind = 'FILE')
  file?: {
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storagePath: string; // bucket/object_path in Supabase Storage
    originalName: string;
  };
  
  // Link storage (if storageKind = 'LINK')
  link?: {
    url: string;
    fetchedAt?: string; // ISO timestamp
    sha256?: string; // SHA-256 of snapshot content
    snapshotStoragePath?: string; // path to snapshot in storage
  };
  
  // Governance
  status: EvidenceStatus;
  version: string;
  effectiveFrom?: string; // ISO timestamp
  effectiveTo?: string; // ISO timestamp
  
  // Authority & Override Policy (ORG scope only)
  authorityLevel?: 'BINDING' | 'INFORMATIONAL'; // BINDING = must be followed, INFORMATIONAL = guidance only
  overridePolicy?: 'LOCKED' | 'ALLOW_SUPPLEMENT' | 'ALLOW_OVERRIDE'; // LOCKED = always included, cannot be disabled
  
  // Audit
  createdBy: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  approvedBy?: string;
  approvedAt?: string; // ISO timestamp
  
  // Indexing status
  indexStatus: EvidenceIndexStatus;
  chunkCount?: number;
  embeddingModel?: string;
  indexError?: string;
  
  // Rule metadata (for RULESET sourceType)
  ruleMeta?: {
    mustSay?: string[];
    mustNotSay?: string[];
    requiredDisclosures?: string[];
    forbiddenClaims?: string[];
    jurisdiction?: string;
    regexRules?: Array<{ pattern: string; flags?: string; description?: string }>;
  };
}

// ============================================================================
// EVIDENCE CHUNK
// ============================================================================

export interface EvidenceChunk {
  id: string;
  evidenceItemId: string;
  orgId: string;
  
  chunkIndex: number; // order within document
  text: string; // chunk text content
  textStartOffset?: number; // character offset in original document
  textEndOffset?: number;
  
  heading?: string; // section heading if available
  metadata?: Record<string, any>; // additional metadata (page number, section, etc.)
  
  embedding?: number[]; // vector embedding as array of numbers
  embeddingModel?: string;
  
  tags: string[]; // inherited from evidence_item
  
  createdAt: string; // ISO timestamp
}

// ============================================================================
// EVIDENCE CITATION
// ============================================================================

export interface EvidenceCitation {
  docId: string; // evidence_item.id
  chunkId?: string; // evidence_chunk.id if from a chunk
  snippet: string; // <= ~240 chars excerpt
  offsets?: { start: number; end: number }; // character offsets in chunk
  score: number; // retrieval score (0..1)
  sourceType: EvidenceSourceType;
  version: string; // evidence_item.version
  sha256: string; // evidence_item.file.sha256 or evidence_item.link.sha256
  title?: string; // evidence_item.title
}

// ============================================================================
// EVIDENCE SET (Resolved for a run)
// ============================================================================

export interface EvidenceSet {
  orgEvidenceIds: string[];
  projectEvidenceIds: string[];
  conversationEvidenceIds: string[];
  templateEvidenceIds: string[];
  resolvedEvidenceIds: string[]; // union of all above, filtered by status/dates
}

// ============================================================================
// EVIDENCE DIAGNOSTICS
// ============================================================================

export interface EvidenceDiagnostics {
  indexingFailures?: Array<{
    evidenceItemId: string;
    error: string;
  }>;
  missingApprovals?: string[]; // evidence_item IDs that were DRAFT but included
  staleDocsUsed?: Array<{
    evidenceItemId: string;
    effectiveTo?: string;
    warning: string;
  }>;
  snapshotStatus?: Array<{
    evidenceItemId: string;
    url: string;
    snapshotAge?: number; // days since fetchedAt
    warning?: string;
  }>;
}

// ============================================================================
// BUSINESS CONTEXT TYPES
// ============================================================================

export type BusinessFunctionPrimary =
  | 'BILLING_SUPPORT'
  | 'CUSTOMER_SUPPORT_RETENTION'
  | 'SALES_ONBOARDING'
  | 'REGULATED_OPERATIONS'
  | 'MIXED';

export type IndustryPrimary =
  | 'FINANCE'
  | 'TELECOM'
  | 'HEALTHCARE'
  | 'INSURANCE'
  | 'SAAS'
  | 'RETAIL'
  | 'GOV'
  | 'OTHER'
  | 'UNKNOWN';

export type LensId =
  | 'regulatory_exposure'
  | 'financial_exposure'
  | 'customer_dispute_risk'
  | 'promise_commitment_risk'
  | 'privacy_security_risk'
  | 'operational_process_risk'
  | 'neutral_engine_order';

export interface DefaultEvidenceInclusion {
  includeOrg: boolean;
  includeProject: boolean;
  includeTemplate: boolean;
}

// ============================================================================
// CANONICAL CATEGORIES
// ============================================================================

export type CanonicalCategory =
  | 'compliance'           // regulations/standards (PCI, HIPAA, SOX)
  | 'privacy_security'     // PII/PHI/PCI handling, credentials, data leakage
  | 'billing_financial'    // fees, refunds, payments, pricing
  | 'promises_consistency'  // contradictions, commitments, "we will"
  | 'policy_process'       // required steps, scripts, disclosures, QA rules
  | 'customer_dispute';    // escalation, chargeback threats, disputes


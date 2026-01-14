/**
 * Evidence System Types
 * Part of ProtectQA Evidence/Policy System + Categories & "View By" Ordering
 */
export type EvidenceScope = 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION';
export type EvidenceSourceType = 'POLICY' | 'RULESET' | 'KNOWLEDGE' | 'ACCOUNT_FACTS' | 'LEGAL' | 'URL_LINK' | 'SYSTEM_EXPORT';
export type EvidenceStorageKind = 'FILE' | 'LINK';
export type EvidenceStatus = 'DRAFT' | 'APPROVED' | 'DEPRECATED';
export type EvidenceIndexStatus = 'PENDING' | 'INDEXED' | 'FAILED';
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
    regions?: string[];
    storageKind: EvidenceStorageKind;
    file?: {
        mimeType: string;
        sizeBytes: number;
        sha256: string;
        storagePath: string;
        originalName: string;
    };
    link?: {
        url: string;
        fetchedAt?: string;
        sha256?: string;
        snapshotStoragePath?: string;
    };
    status: EvidenceStatus;
    version: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    authorityLevel?: 'BINDING' | 'INFORMATIONAL';
    overridePolicy?: 'LOCKED' | 'ALLOW_SUPPLEMENT' | 'ALLOW_OVERRIDE';
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    approvedBy?: string;
    approvedAt?: string;
    indexStatus: EvidenceIndexStatus;
    chunkCount?: number;
    embeddingModel?: string;
    indexError?: string;
    ruleMeta?: {
        mustSay?: string[];
        mustNotSay?: string[];
        requiredDisclosures?: string[];
        forbiddenClaims?: string[];
        jurisdiction?: string;
        regexRules?: Array<{
            pattern: string;
            flags?: string;
            description?: string;
        }>;
    };
}
export interface EvidenceChunk {
    id: string;
    evidenceItemId: string;
    orgId: string;
    chunkIndex: number;
    text: string;
    textStartOffset?: number;
    textEndOffset?: number;
    heading?: string;
    metadata?: Record<string, any>;
    embedding?: number[];
    embeddingModel?: string;
    tags: string[];
    createdAt: string;
}
export interface EvidenceCitation {
    docId: string;
    chunkId?: string;
    snippet: string;
    offsets?: {
        start: number;
        end: number;
    };
    score: number;
    sourceType: EvidenceSourceType;
    version: string;
    sha256: string;
    title?: string;
}
export interface EvidenceSet {
    orgEvidenceIds: string[];
    projectEvidenceIds: string[];
    conversationEvidenceIds: string[];
    templateEvidenceIds: string[];
    resolvedEvidenceIds: string[];
}
export interface EvidenceDiagnostics {
    indexingFailures?: Array<{
        evidenceItemId: string;
        error: string;
    }>;
    missingApprovals?: string[];
    staleDocsUsed?: Array<{
        evidenceItemId: string;
        effectiveTo?: string;
        warning: string;
    }>;
    snapshotStatus?: Array<{
        evidenceItemId: string;
        url: string;
        snapshotAge?: number;
        warning?: string;
    }>;
}
export type BusinessFunctionPrimary = 'BILLING_SUPPORT' | 'CUSTOMER_SUPPORT_RETENTION' | 'SALES_ONBOARDING' | 'REGULATED_OPERATIONS' | 'MIXED';
export type IndustryPrimary = 'FINANCE' | 'TELECOM' | 'HEALTHCARE' | 'INSURANCE' | 'SAAS' | 'RETAIL' | 'GOV' | 'OTHER' | 'UNKNOWN';
export type LensId = 'regulatory_exposure' | 'financial_exposure' | 'customer_dispute_risk' | 'promise_commitment_risk' | 'privacy_security_risk' | 'operational_process_risk' | 'neutral_engine_order';
export interface DefaultEvidenceInclusion {
    includeOrg: boolean;
    includeProject: boolean;
    includeTemplate: boolean;
}
export type CanonicalCategory = 'compliance' | 'privacy_security' | 'billing_financial' | 'promises_consistency' | 'policy_process' | 'customer_dispute';

/**
 * Evidence Service
 * Handles CRUD operations for evidence items
 * Part of ProtectQA Evidence/Policy System
 */
import type { EvidenceItem, EvidenceScope, EvidenceSourceType, EvidenceStatus, EvidenceIndexStatus, EvidenceSet } from '../../types/evidence.types.js';
export interface CreateEvidenceItemInput {
    orgId: string;
    projectId?: string;
    conversationId?: string;
    templateId?: string;
    scope: EvidenceScope;
    sourceType: EvidenceSourceType;
    title: string;
    description?: string;
    tags?: string[];
    regions?: string[];
    storageKind: 'FILE' | 'LINK';
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
    status?: EvidenceStatus;
    version?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    createdBy: string;
    authorityLevel?: 'BINDING' | 'INFORMATIONAL';
    overridePolicy?: 'LOCKED' | 'ALLOW_SUPPLEMENT' | 'ALLOW_OVERRIDE';
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
export interface UpdateEvidenceItemInput {
    title?: string;
    description?: string;
    tags?: string[];
    regions?: string[];
    status?: EvidenceStatus;
    version?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    authorityLevel?: 'BINDING' | 'INFORMATIONAL';
    overridePolicy?: 'LOCKED' | 'ALLOW_SUPPLEMENT' | 'ALLOW_OVERRIDE';
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
/**
 * Create a new evidence item
 */
export declare function createEvidenceItem(input: CreateEvidenceItemInput): Promise<EvidenceItem>;
/**
 * Get evidence item by ID
 */
export declare function getEvidenceItemById(evidenceItemId: string, orgId: string): Promise<EvidenceItem | null>;
/**
 * List evidence items for an org/project/template/conversation
 */
export interface ListEvidenceItemsOptions {
    orgId: string;
    projectId?: string;
    conversationId?: string;
    templateId?: string;
    scope?: EvidenceScope;
    sourceType?: EvidenceSourceType;
    status?: EvidenceStatus;
    indexStatus?: EvidenceIndexStatus;
    tags?: string[];
    limit?: number;
    offset?: number;
}
export declare function listEvidenceItems(options: ListEvidenceItemsOptions): Promise<{
    items: EvidenceItem[];
    total: number;
}>;
/**
 * Update evidence item
 */
export declare function updateEvidenceItem(evidenceItemId: string, orgId: string, input: UpdateEvidenceItemInput, updatedBy?: string): Promise<EvidenceItem>;
/**
 * Approve evidence item
 */
export declare function approveEvidenceItem(evidenceItemId: string, orgId: string, approvedBy: string): Promise<EvidenceItem>;
/**
 * Deprecate evidence item
 */
export declare function deprecateEvidenceItem(evidenceItemId: string, orgId: string, deprecatedBy: string, notes?: string): Promise<EvidenceItem>;
/**
 * Update indexing status
 */
export declare function updateIndexingStatus(evidenceItemId: string, status: EvidenceIndexStatus, chunkCount?: number, embeddingModel?: string, indexError?: string): Promise<void>;
/**
 * Resolve evidence set for an evaluation run
 * Uses the database function resolve_evidence_set()
 */
export declare function resolveEvidenceSet(orgId: string, projectId?: string, templateId?: string, conversationId?: string, simulationMode?: boolean, includeOrg?: boolean, includeProject?: boolean, includeTemplate?: boolean): Promise<EvidenceSet>;

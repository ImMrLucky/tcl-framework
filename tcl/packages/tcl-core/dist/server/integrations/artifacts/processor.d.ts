/**
 * Artifact Processing
 * Handles normalization and storage of conversation artifacts
 */
import type { ConversationArtifact } from '../types.js';
export interface ProcessedArtifact {
    artifactId: string;
    normalizedText?: string;
}
/**
 * Process artifacts and create database records
 */
export declare function processArtifacts(orgId: string, projectId: string, env: 'sandbox' | 'production', conversationId: string, artifacts: ConversationArtifact[]): Promise<ProcessedArtifact[]>;
/**
 * Check idempotency and return existing conversation if found
 */
export declare function checkIdempotency(orgId: string, provider: string, externalId: string): Promise<string | null>;
/**
 * Store idempotency key
 */
export declare function storeIdempotencyKey(orgId: string, provider: string, externalId: string, conversationId: string): Promise<void>;

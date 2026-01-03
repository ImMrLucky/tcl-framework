/**
 * Ingestion Endpoint
 *
 * Handles file uploads and normalization for ProtectQA.
 * Integrates with the existing conversation and evaluation pipeline.
 */
import express from "express";
import { normalizeFile, NormalizedConversation } from "./normalizers/index.js";
import { extractClaimsWithAnchors, buildIssueDTOs } from "./issue-derivation.js";
export interface IngestRequest {
    /** File content (base64 or text) */
    content: string;
    /** Original filename */
    filename: string;
    /** Optional: conversation ID to attach to */
    conversationId?: string;
    /** Optional: title for the conversation */
    title?: string;
    /** Optional: speaker role overrides */
    speakerOverrides?: Record<string, string>;
    /** Whether to run evaluation immediately */
    runEvaluation?: boolean;
}
export interface IngestResponse {
    success: boolean;
    /** The normalized conversation */
    normalized?: NormalizedConversation;
    /** Artifact ID */
    artifactId?: string;
    /** Conversation ID */
    conversationId?: string;
    /** Warnings from normalization */
    warnings?: string[];
    /** Error message if failed */
    error?: string;
}
export declare function registerIngestEndpoints(app: express.Express): void;
export { normalizeFile, extractClaimsWithAnchors, buildIssueDTOs };

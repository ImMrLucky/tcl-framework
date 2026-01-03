/**
 * Evidence Source Generation
 *
 * This module generates source chunks from normalized conversations for:
 * 1. Grounding claims to transcript evidence
 * 2. Retrieval-based NLI scoring
 * 3. Evidence attribution for issues
 *
 * CRITICAL: Every conversation must generate sources, even without external documents.
 * Without sources, the NLI graph has no grounding and spectral analysis is meaningless.
 */
import type { Source, Claim } from "./types.js";
import type { NormalizedConversation } from "./server/ingestion/types.js";
export interface TranscriptChunk extends Source {
    /** Turn index in normalized conversation */
    turnIndex: number;
    /** Chunk index within turn (for multi-sentence turns) */
    chunkIndex: number;
    /** Speaker role */
    role: string;
    /** Speaker label */
    speakerLabel: string;
    /** Start time in ms (for audio) */
    startTimeMs?: number;
    /** End time in ms */
    endTimeMs?: number;
    /** Participant ID */
    participantId: string;
    /** Character offsets */
    charStart?: number;
    charEnd?: number;
}
export interface EvidenceHit {
    /** Source chunk ID */
    sourceId: string;
    /** Source text */
    text: string;
    /** Similarity score (0-1) */
    similarity: number;
    /** Optional: turn index */
    turnIndex?: number;
    /** Optional: speaker */
    speaker?: string;
}
export interface ClaimEvidenceAttribution {
    /** Claim ID */
    claimId: string;
    /** Evidence hits with NLI scores */
    evidence: Array<{
        sourceId: string;
        text: string;
        nliScore: number;
        nliLabel: "ENTAILMENT" | "CONTRADICTION" | "NEUTRAL";
        turnIndex?: number;
        speaker?: string;
    }>;
}
/**
 * Default chunk settings
 */
declare const CHUNK_CONFIG: {
    /** Target chunk size in characters */
    targetSize: number;
    /** Maximum chunk size */
    maxSize: number;
    /** Minimum chunk size (smaller chunks are merged with next) */
    minSize: number;
    /** Overlap between chunks */
    overlap: number;
};
/**
 * Generate a stable ID for a transcript chunk
 */
export declare function generateChunkId(conversationId: string, turnIndex: number, chunkIndex: number): string;
/**
 * Generate transcript source chunks from a normalized conversation
 *
 * CRITICAL: This MUST be called for every conversation to enable:
 * - Grounding edges in the claim graph
 * - Evidence attribution for issues
 * - Spectral analysis with non-trivial results
 */
export declare function generateTranscriptSources(conversation: NormalizedConversation, conversationId: string, options?: {
    chunkConfig?: Partial<typeof CHUNK_CONFIG>;
}): TranscriptChunk[];
/**
 * Generate sources from raw transcript text (when no normalized conversation available)
 *
 * This is a fallback for backwards compatibility when transcript is provided as raw text.
 */
export declare function generateSourcesFromRawTranscript(transcript: string, conversationId?: string): Source[];
/**
 * Retrieve top-k evidence chunks for a claim
 *
 * Uses simple embedding + cosine similarity for fast retrieval.
 * In production, use a proper vector store (Pinecone, Weaviate, etc.)
 */
export declare function retrieveEvidence(claim: Claim, sources: Source[], k?: number): EvidenceHit[];
/**
 * Retrieve evidence for all claims in batch
 */
export declare function retrieveEvidenceForClaims(claims: Claim[], sources: Source[], k?: number): Map<string, EvidenceHit[]>;
export {};

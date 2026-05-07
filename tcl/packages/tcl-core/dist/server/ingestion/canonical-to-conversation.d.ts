/**
 * Convert Canonical Transcript to Conversation
 *
 * Helper functions to create conversations and optionally evaluations
 * from canonical transcript format.
 */
import type { CanonicalTranscript } from './canonical-transcript.js';
export interface ConversationCreationResult {
    conversation_id: string;
    evaluation_id?: string;
    warnings?: string[];
}
/**
 * Create a conversation from a canonical transcript
 */
export declare function createConversationFromCanonical(orgId: string, projectId: string, env: string, userId: string, transcript: CanonicalTranscript, options?: {
    title?: string;
    channel?: string;
    representativeId?: string | null;
    templateId?: string | null;
    autoAnalyze?: boolean;
}): Promise<ConversationCreationResult>;
/**
 * Create multiple conversations from canonical transcripts
 */
export declare function createConversationsFromCanonicalBatch(orgId: string, projectId: string, env: string, userId: string, transcripts: CanonicalTranscript[], options?: {
    title?: string;
    channel?: string;
    representativeId?: string | null;
    templateId?: string | null;
    autoAnalyze?: boolean;
}): Promise<Array<ConversationCreationResult & {
    transcript: CanonicalTranscript;
}>>;

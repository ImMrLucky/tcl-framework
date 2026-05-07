/**
 * Speaker Role Mapper
 *
 * Normalizes transcript speakers to canonical roles (REPRESENTATIVE | CUSTOMER | THIRD_PARTY | UNKNOWN)
 *
 * This is the single source of truth for role assignment per conversation.
 * The mapping is computed once and stored in conversation.metadata.speakerRoleMap.
 */
export type Role = 'REPRESENTATIVE' | 'CUSTOMER' | 'THIRD_PARTY' | 'UNKNOWN';
export interface TranscriptTurn {
    speaker: string;
    text: string;
}
/**
 * Build speaker role map for a conversation
 *
 * Priority (STRICT ORDER):
 * 1. Explicit labels (agent, rep, customer, client, etc.)
 * 2. Template defaults (optional future use)
 * 3. Two-speaker heuristic (if exactly 2 speakers)
 * 4. Fallback to UNKNOWN
 */
export declare function buildSpeakerRoleMap(transcriptTurns: TranscriptTurn[], templateId?: string): Record<string, Role>;
/**
 * Get role for a speaker from the map, with fallback
 */
export declare function getRoleForSpeaker(speaker: string, speakerRoleMap: Record<string, Role>): Role;

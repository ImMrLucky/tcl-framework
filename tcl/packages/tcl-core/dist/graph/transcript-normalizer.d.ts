/**
 * Transcript Normalizer
 *
 * Normalizes transcript text into structured turns with speaker information.
 * Preserves speaker labels and maps them to canonical roles.
 *
 * Part B: Fix speaker attribution
 */
export type SpeakerType = "agent" | "customer" | "supervisor" | "bot" | "system" | "unknown";
export type SpeakerRole = "AGENT" | "CUSTOMER" | "MIXED" | "UNKNOWN";
export interface NormalizedTurn {
    turnIndex: number;
    speakerLabelRaw: string;
    speakerType: SpeakerType;
    text: string;
}
/**
 * Normalize transcript into structured turns
 *
 * Input: Raw transcript string with speaker labels
 * Output: Array of normalized turns with speaker information
 */
export declare function normalizeTranscript(transcript: string, options?: {
    agentLabels?: string[];
    customerLabels?: string[];
}): NormalizedTurn[];
/**
 * Convert SpeakerType to SpeakerRole (for IssueV2 compatibility)
 */
export declare function speakerTypeToRole(speakerType: SpeakerType): SpeakerRole;
/**
 * Derive issue speaker from multiple claims
 */
export declare function deriveIssueSpeaker(claimSpeakers: Array<{
    speakerType: SpeakerType;
    speakerLabel?: string;
}>): {
    speaker: SpeakerRole;
    speakerLabel?: string;
};

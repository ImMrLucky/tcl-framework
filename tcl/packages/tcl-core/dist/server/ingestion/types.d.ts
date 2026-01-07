/**
 * ProtectQA Normalized Conversation Schema
 *
 * All external formats (TXT, CSV, JSON, VTT, audio) are normalized to this
 * single internal model before claim extraction and analysis.
 *
 * This ensures:
 * - Deterministic evaluation replay
 * - Consistent evidence anchoring
 * - Speaker-aware claim extraction
 * - Audit-grade traceability
 */
export declare const NORMALIZED_SCHEMA_VERSION = "norm.v1";
export type Channel = "call" | "chat" | "email" | "other";
export type SourceFormat = "txt" | "csv" | "json" | "vtt" | "srt" | "wav" | "mp3" | "m4a" | "flac" | "ogg" | "opus" | "vendor:amazon_connect" | "vendor:genesys" | "vendor:five9" | "vendor:nice" | "vendor:verint" | "vendor:twilio" | "unknown";
export type ParticipantRole = "agent" | "customer" | "supervisor" | "bot" | "unknown";
export interface Participant {
    /** Unique ID within this conversation (e.g., "p_agent_1") */
    participantId: string;
    /** Display name (e.g., "Agent", "John Smith") */
    displayName: string;
    /** Normalized role */
    role: ParticipantRole;
    /** External reference (e.g., employee ID) */
    externalRef?: string;
}
export interface Turn {
    /** 0-indexed turn number */
    turnIndex: number;
    /** Reference to participant */
    participantId: string;
    /** Denormalized role for convenience */
    role: ParticipantRole;
    /** Display label (e.g., "Agent", "Customer") */
    speakerLabel: string;
    /** The utterance text */
    text: string;
    /** Start time in milliseconds (for audio-derived transcripts) */
    startTimeMs?: number;
    /** End time in milliseconds */
    endTimeMs?: number;
    /** Line number in source file (1-indexed) */
    lineStart?: number;
    /** End line number (for multi-line turns) */
    lineEnd?: number;
    /** Character offset start in source */
    charStart?: number;
    /** Character offset end in source */
    charEnd?: number;
    /** Confidence score (0-1, for ASR-derived text) */
    confidence?: number;
    /** Metadata for deterministic replay */
    meta: {
        /** Raw speaker label from source */
        rawSpeaker?: string;
        /** Any other raw fields from source */
        rawFields?: Record<string, any>;
        /** Speaker mapping decision made */
        mappingDecision?: string;
    };
}
export interface Attachment {
    attachmentId: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    storageRef?: string;
    checksum?: string;
}
export interface RawSourceMetadata {
    /** SHA-256 checksum of original file */
    checksum: string;
    /** Size in bytes */
    byteSize: number;
    /** When the file was ingested */
    ingestedAt: string;
    /** Original filename */
    originalFilename: string;
    /** Detected encoding (for text files) */
    encoding?: string;
    /** Column mapping used (for CSV) */
    columnMapping?: {
        speaker?: string;
        text?: string;
        time?: string;
    };
    /** Heuristics applied */
    heuristicsApplied?: string[];
    /** Any inferred values */
    inferredValues?: Record<string, any>;
}
export interface NormalizedConversation {
    /** Schema version for future migrations */
    schemaVersion: typeof NORMALIZED_SCHEMA_VERSION;
    /** Channel type */
    channel: Channel;
    /** Source format */
    sourceFormat: SourceFormat;
    /** Language code */
    language: string;
    /** Timezone */
    timezone: string;
    /** Conversation metadata */
    conversation: {
        externalId?: string;
        title?: string;
        startedAt?: string;
        endedAt?: string;
    };
    /** Participants list */
    participants: Participant[];
    /** Turns (the main content) */
    turns: Turn[];
    /** Attachments */
    attachments: Attachment[];
    /** Raw source metadata for replay */
    raw: RawSourceMetadata;
}
export interface ClaimWithAnchors {
    /** Stable, deterministic claim ID */
    id: string;
    /** The claim text */
    text: string;
    /** Turn index in normalized conversation */
    turnIndex: number;
    /** Participant ID */
    participantId: string;
    /** Role */
    role: ParticipantRole;
    /** Speaker label for display */
    speakerLabel: string;
    /** Artifact ID (conversation_artifacts.id) */
    artifactId: string;
    /** Line start in source */
    lineStart?: number;
    /** Line end in source */
    lineEnd?: number;
    /** Start time in ms (for audio) */
    startTimeMs?: number;
    /** End time in ms */
    endTimeMs?: number;
    /** Character start in source */
    charStart?: number;
    /** Character end in source */
    charEnd?: number;
    /** Extraction metadata */
    meta: {
        extractorVersion: string;
        sentenceIndex: number;
        confidence?: number;
    };
}
export type IssueType = "contradiction" | "ungrounded" | "unverified" | "inconsistent_support" | "inconsistent_contradiction" | "needs_review";
export interface IssueDTO {
    /** 1-indexed rank */
    rank: number;
    /** Deterministically derived issue type */
    issueType: IssueType;
    /** Severity score (0-100) */
    severity: number;
    /** Claim ID */
    claimId: string;
    /** Claim text */
    claimText: string;
    /** Speaker role */
    speakerRole: ParticipantRole;
    /** Speaker label */
    speakerLabel: string;
    /** Artifact ID */
    artifactId: string;
    /** Turn index */
    turnIndex: number;
    /** Line start */
    lineStart?: number;
    /** Line end */
    lineEnd?: number;
    /** Start time in ms */
    startTimeMs?: number;
    /** End time in ms */
    endTimeMs?: number;
    /** Human-readable explanation */
    why: string;
    /** Related edges */
    relatedEdges: Array<{
        type: "contradiction" | "support";
        claimAId: string;
        claimBId: string;
        badness: number;
    }>;
    /** Available actions */
    actions: string[];
}
export interface NormalizerOptions {
    /** Force a specific speaker role mapping */
    speakerOverrides?: Record<string, ParticipantRole>;
    /** Default timezone if not detected */
    defaultTimezone?: string;
    /** Default language if not detected */
    defaultLanguage?: string;
    /** Artifact ID to associate with claims */
    artifactId?: string;
}
export interface NormalizerResult {
    /** The normalized conversation */
    normalized: NormalizedConversation;
    /** Warnings encountered during normalization */
    warnings: string[];
    /** Whether normalization was successful */
    success: boolean;
}
export interface Normalizer {
    /** Name of the normalizer */
    name: string;
    /** Supported file extensions */
    extensions: string[];
    /** Check if this normalizer can handle the file */
    canHandle(fileMeta: {
        filename: string;
        mimeType?: string;
    }, headBytes: Buffer): boolean;
    /** Normalize the file content */
    normalize(content: Buffer | string, options: NormalizerOptions): Promise<NormalizerResult>;
}
/**
 * Speaker role mapping rules
 */
export declare const SPEAKER_ROLE_PATTERNS: Record<ParticipantRole, RegExp[]>;
/**
 * Map a raw speaker label to a canonical role
 */
export declare function mapSpeakerToRole(rawSpeaker: string): {
    role: ParticipantRole;
    mappingDecision: string;
};
export declare const CSV_SPEAKER_ALIASES: string[];
export declare const CSV_TEXT_ALIASES: string[];
export declare const CSV_TIME_ALIASES: string[];
/**
 * Detect column mapping from CSV headers
 */
export declare function detectCSVColumnMapping(headers: string[]): {
    speaker?: string;
    text?: string;
    time?: string;
    ambiguous: boolean;
};
/**
 * Generate a stable, deterministic claim ID
 * Based on: artifactId + turnIndex + sentenceIndex + normalized claim text
 */
export declare function generateClaimId(artifactId: string, turnIndex: number, sentenceIndex: number, claimText: string): string;
/**
 * Generate SHA-256 checksum of content
 */
export declare function generateChecksum(content: Buffer | string): string;

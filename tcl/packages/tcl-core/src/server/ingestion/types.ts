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

// =============================================================================
// SCHEMA VERSION
// =============================================================================

export const NORMALIZED_SCHEMA_VERSION = "norm.v1";

// =============================================================================
// ENUMS
// =============================================================================

export type Channel = "call" | "chat" | "email" | "other";

export type SourceFormat = 
  | "txt" | "csv" | "json" | "vtt" | "srt" 
  | "wav" | "mp3" | "m4a" | "flac" | "ogg" | "opus"
  | "vendor:amazon_connect" | "vendor:genesys" | "vendor:five9" 
  | "vendor:nice" | "vendor:verint" | "vendor:twilio"
  | "unknown";

export type ParticipantRole = "agent" | "customer" | "supervisor" | "bot" | "system" | "unknown";

// =============================================================================
// PARTICIPANT
// =============================================================================

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

// =============================================================================
// TURN
// =============================================================================

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

// =============================================================================
// ATTACHMENT
// =============================================================================

export interface Attachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageRef?: string;
  checksum?: string;
}

// =============================================================================
// RAW SOURCE METADATA
// =============================================================================

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

// =============================================================================
// NORMALIZED CONVERSATION
// =============================================================================

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

// =============================================================================
// CLAIM WITH EVIDENCE ANCHORS
// =============================================================================

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

// =============================================================================
// ISSUE DTO (Product Output)
// =============================================================================

export type IssueType = 
  | "contradiction"
  | "ungrounded"
  | "unverified"  // NEW: Has transcript evidence but no external verification
  | "risky_commitment_unverified"  // NEW: Agent promise/commitment that is unverified
  | "inconsistent_support"
  | "inconsistent_contradiction"
  | "needs_review";

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

// =============================================================================
// NORMALIZER INTERFACE
// =============================================================================

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
  canHandle(fileMeta: { filename: string; mimeType?: string }, headBytes: Buffer): boolean;
  /** Normalize the file content */
  normalize(content: Buffer | string, options: NormalizerOptions): Promise<NormalizerResult>;
}

export { mapSpeakerToRole } from "../../ingestion/speaker-role.js";

// =============================================================================
// CSV COLUMN MAPPING
// =============================================================================

export const CSV_SPEAKER_ALIASES = [
  "speaker", "agent", "role", "participant", "author", "from", "sender", "user", "name"
];

export const CSV_TEXT_ALIASES = [
  "text", "utterance", "message", "content", "transcript", "body", "comment", "dialogue"
];

export const CSV_TIME_ALIASES = [
  "timestamp", "time", "start", "start_ms", "startTime", "start_time", 
  "end", "end_ms", "endTime", "end_time", "datetime", "date"
];

/**
 * Detect column mapping from CSV headers
 */
export function detectCSVColumnMapping(headers: string[]): {
  speaker?: string;
  text?: string;
  time?: string;
  ambiguous: boolean;
} {
  const normalizedHeaders = headers.map(h => h.trim().toLowerCase());
  
  const findColumn = (aliases: string[]): string | undefined => {
    for (const alias of aliases) {
      const idx = normalizedHeaders.findIndex(h => h === alias || h.includes(alias));
      if (idx >= 0) return headers[idx];
    }
    return undefined;
  };
  
  const speaker = findColumn(CSV_SPEAKER_ALIASES);
  const text = findColumn(CSV_TEXT_ALIASES);
  const time = findColumn(CSV_TIME_ALIASES);
  
  // Check for ambiguity
  const ambiguous = !text; // At minimum, we need to find a text column
  
  return { speaker, text, time, ambiguous };
}

// =============================================================================
// DETERMINISTIC CLAIM ID GENERATION
// =============================================================================

import { createHash } from "crypto";

/**
 * Generate a stable, deterministic claim ID
 * Based on: artifactId + turnIndex + sentenceIndex + normalized claim text
 */
export function generateClaimId(
  artifactId: string,
  turnIndex: number,
  sentenceIndex: number,
  claimText: string
): string {
  const normalized = claimText.trim().toLowerCase().replace(/\s+/g, " ");
  const input = `${artifactId}:${turnIndex}:${sentenceIndex}:${normalized}`;
  const hash = createHash("sha256").update(input).digest("hex").substring(0, 12);
  return `c_${hash}`;
}

// =============================================================================
// CHECKSUM GENERATION
// =============================================================================

/**
 * Generate SHA-256 checksum of content
 */
export function generateChecksum(content: Buffer | string): string {
  const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}


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
// SPEAKER MAPPING
// =============================================================================
/**
 * Speaker role mapping rules
 */
export const SPEAKER_ROLE_PATTERNS = {
    agent: [
        /agent/i, /rep/i, /csr/i, /advisor/i, /representative/i,
        /associate/i, /operator/i, /specialist/i, /consultant/i
    ],
    customer: [
        /customer/i, /caller/i, /client/i, /member/i, /user/i,
        /guest/i, /visitor/i, /patient/i, /subscriber/i
    ],
    supervisor: [
        /supervisor/i, /manager/i, /lead/i, /senior/i, /director/i
    ],
    bot: [
        /bot/i, /ivr/i, /system/i, /auto/i, /virtual/i, /ai/i
    ],
    unknown: []
};
/**
 * Map a raw speaker label to a canonical role
 */
export function mapSpeakerToRole(rawSpeaker) {
    const normalized = rawSpeaker.trim().toLowerCase();
    for (const [role, patterns] of Object.entries(SPEAKER_ROLE_PATTERNS)) {
        if (role === "unknown")
            continue;
        for (const pattern of patterns) {
            if (pattern.test(normalized)) {
                return {
                    role: role,
                    mappingDecision: `matched pattern ${pattern.source} -> ${role}`
                };
            }
        }
    }
    return { role: "unknown", mappingDecision: "no pattern matched" };
}
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
export function detectCSVColumnMapping(headers) {
    const normalizedHeaders = headers.map(h => h.trim().toLowerCase());
    const findColumn = (aliases) => {
        for (const alias of aliases) {
            const idx = normalizedHeaders.findIndex(h => h === alias || h.includes(alias));
            if (idx >= 0)
                return headers[idx];
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
export function generateClaimId(artifactId, turnIndex, sentenceIndex, claimText) {
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
export function generateChecksum(content) {
    const buffer = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
    return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}

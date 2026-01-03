/**
 * Normalizer Index
 *
 * Central registry for all format normalizers.
 * Provides automatic format detection and normalization.
 */
import { NORMALIZED_SCHEMA_VERSION, generateChecksum } from "../types.js";
import { txtSpeakerPrefixedNormalizer } from "./txt-speaker-prefixed.js";
import { csvTurnsNormalizer } from "./csv-turns.js";
import { jsonTurnsNormalizer } from "./json-turns.js";
import { vttSrtNormalizer } from "./vtt-srt.js";
// =============================================================================
// NORMALIZER REGISTRY
// =============================================================================
/**
 * All registered normalizers, in priority order
 */
const NORMALIZERS = [
    jsonTurnsNormalizer,
    csvTurnsNormalizer,
    vttSrtNormalizer,
    txtSpeakerPrefixedNormalizer,
];
/**
 * Audio file extensions (metadata only, no text parsing)
 */
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"];
/**
 * Detect the format of a file and find the appropriate normalizer
 */
export function detectFormat(filename, mimeType, headBytes) {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
    // Check for audio files
    if (AUDIO_EXTENSIONS.includes(ext)) {
        return {
            normalizer: null,
            format: ext.substring(1),
            isAudio: true,
            confidence: 1.0,
        };
    }
    // Try each normalizer
    for (const normalizer of NORMALIZERS) {
        if (normalizer.canHandle({ filename, mimeType }, headBytes)) {
            return {
                normalizer,
                format: normalizer.name,
                isAudio: false,
                confidence: 0.9,
            };
        }
    }
    // Fallback: try txt normalizer for unknown text files
    if (mimeType?.startsWith("text/") || ext === ".txt") {
        return {
            normalizer: txtSpeakerPrefixedNormalizer,
            format: "txt-fallback",
            isAudio: false,
            confidence: 0.5,
        };
    }
    return {
        normalizer: null,
        format: "unknown",
        isAudio: false,
        confidence: 0,
    };
}
// =============================================================================
// MAIN NORMALIZATION FUNCTION
// =============================================================================
/**
 * Normalize any supported file format to NormalizedConversation
 */
export async function normalizeFile(content, filename, options = {}) {
    const headBytes = typeof content === "string"
        ? Buffer.from(content.substring(0, 4000), "utf-8")
        : content.slice(0, 4000);
    const detection = detectFormat(filename, undefined, headBytes);
    // Handle audio files
    if (detection.isAudio) {
        return {
            normalized: createAudioMetadataConversation(content, filename, detection.format),
            warnings: ["Audio file detected; only metadata stored. Attach transcript separately."],
            success: true,
        };
    }
    // No normalizer found
    if (!detection.normalizer) {
        return {
            normalized: createUnknownConversation(content, filename),
            warnings: [`Unknown format: ${filename}. Could not parse.`],
            success: false,
        };
    }
    // Run normalization
    const result = await detection.normalizer.normalize(content, options);
    // Set original filename
    result.normalized.raw.originalFilename = filename;
    return result;
}
// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
/**
 * Create a conversation entry for an audio file (metadata only)
 */
function createAudioMetadataConversation(content, filename, format) {
    const byteSize = typeof content === "string" ? Buffer.byteLength(content) : content.length;
    return {
        schemaVersion: NORMALIZED_SCHEMA_VERSION,
        channel: "call",
        sourceFormat: format,
        language: "en",
        timezone: "UTC",
        conversation: {},
        participants: [],
        turns: [],
        attachments: [
            {
                attachmentId: `audio_${Date.now()}`,
                filename,
                mimeType: getMimeType(format),
                byteSize,
                checksum: generateChecksum(content),
            },
        ],
        raw: {
            checksum: generateChecksum(content),
            byteSize,
            ingestedAt: new Date().toISOString(),
            originalFilename: filename,
            heuristicsApplied: ["audio-metadata-only"],
            inferredValues: {
                isAudio: true,
                needsTranscript: true,
            },
        },
    };
}
/**
 * Create a conversation entry for unknown format
 */
function createUnknownConversation(content, filename) {
    return {
        schemaVersion: NORMALIZED_SCHEMA_VERSION,
        channel: "other",
        sourceFormat: "unknown",
        language: "en",
        timezone: "UTC",
        conversation: {},
        participants: [],
        turns: [],
        attachments: [],
        raw: {
            checksum: generateChecksum(content),
            byteSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
            ingestedAt: new Date().toISOString(),
            originalFilename: filename,
        },
    };
}
/**
 * Get MIME type for audio format
 */
function getMimeType(format) {
    const mimeTypes = {
        wav: "audio/wav",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        aac: "audio/aac",
        flac: "audio/flac",
        ogg: "audio/ogg",
        opus: "audio/opus",
    };
    return mimeTypes[format] || "audio/unknown";
}
// =============================================================================
// EXPORTS
// =============================================================================
export { txtSpeakerPrefixedNormalizer, csvTurnsNormalizer, jsonTurnsNormalizer, vttSrtNormalizer, NORMALIZERS, };
export * from "../types.js";

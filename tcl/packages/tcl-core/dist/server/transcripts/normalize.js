/**
 * Transcript Normalization
 * Extracts text from various transcript formats into a single string
 */
import { normalizeFile } from '../ingestion/normalizers/index.js';
import fs from 'fs';
import { promisify } from 'util';
const fsReadFile = promisify(fs.readFile);
/**
 * Normalize a transcript file to text
 * Supports: .txt, .csv, .json, .vtt, .srt
 */
export async function normalizeTranscript(filePath, filename) {
    const content = typeof filePath === 'string'
        ? await fsReadFile(filePath)
        : filePath;
    // Use existing normalizer infrastructure
    const result = await normalizeFile(content, filename);
    if (!result.success || !result.normalized) {
        throw new Error(`Failed to normalize transcript: ${result.warnings?.join(', ')}`);
    }
    // Extract text from normalized conversation
    const normalized = result.normalized;
    const text = normalized.turns
        .map(t => t.text)
        .join(' ')
        .trim();
    // Extract segments if timestamps are available
    const segments = normalized.turns
        .filter(t => t.startTimeMs !== undefined && t.endTimeMs !== undefined)
        .map(t => ({
        startMs: t.startTimeMs,
        endMs: t.endTimeMs,
        text: t.text,
        speaker: t.speakerLabel,
    }));
    return {
        text,
        segments: segments.length > 0 ? segments : undefined,
        language: normalized.language,
        metadata: {
            sourceFormat: normalized.sourceFormat,
            channel: normalized.channel,
            turnsCount: normalized.turns.length,
            participantsCount: normalized.participants.length,
        },
    };
}
/**
 * Normalize transcript from buffer (for uploaded files)
 */
export async function normalizeTranscriptBuffer(buffer, filename) {
    return normalizeTranscript(buffer, filename);
}

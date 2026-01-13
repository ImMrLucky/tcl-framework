/**
 * Transcript Normalization
 * Extracts text from various transcript formats into a single string
 */

import { normalizeFile, NormalizerResult } from '../ingestion/normalizers/index.js';
import fs from 'fs';
import { promisify } from 'util';

const fsReadFile = promisify(fs.readFile);

export interface NormalizedTranscript {
  text: string;
  segments?: Array<{
    startMs: number;
    endMs: number;
    text: string;
    speaker?: string;
  }>;
  language?: string;
  metadata?: Record<string, any>;
  // CRITICAL: Preserve normalized conversation structure so speaker info isn't lost
  normalizedConversation?: import('../ingestion/types.js').NormalizedConversation;
}

/**
 * Normalize a transcript file to text
 * Supports: .txt, .csv, .json, .vtt, .srt
 */
export async function normalizeTranscript(
  filePath: string | Buffer,
  filename: string
): Promise<NormalizedTranscript> {
  const content = typeof filePath === 'string' 
    ? await fsReadFile(filePath)
    : filePath;

  // Use existing normalizer infrastructure
  const result: NormalizerResult = await normalizeFile(content, filename);

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
      startMs: t.startTimeMs!,
      endMs: t.endTimeMs!,
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
    // CRITICAL: Preserve the full normalized conversation so speaker info can be used in analysis
    normalizedConversation: normalized,
  };
}

/**
 * Normalize transcript from buffer (for uploaded files)
 */
export async function normalizeTranscriptBuffer(
  buffer: Buffer,
  filename: string
): Promise<NormalizedTranscript> {
  return normalizeTranscript(buffer, filename);
}


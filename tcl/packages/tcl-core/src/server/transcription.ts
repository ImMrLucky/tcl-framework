/**
 * Audio Transcription Service
 * Uses whisper.cpp + VAD preprocessing (Railway-friendly, no WASM dependencies)
 * 
 * Does not store audio files - only extracts and returns text
 */

import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { prepareWavForAsr, applyVad } from './asr/vad.js';
import { runWhisperCpp } from './asr/whispercpp.js';
import { withTranscriptionSlot } from './asr/limit.js';

const fsUnlink = promisify(fs.unlink);
const fsExists = promisify(fs.exists);

export interface TranscriptionResult {
  transcript: string;
  text?: string; // Alias for transcript (backward compatibility)
  language?: string;
  duration?: number;
  // New optional fields (non-breaking)
  segments?: Array<{
    startMs: number;
    endMs: number;
    text: string;
  }>;
  durationMs?: number;
  vadStats?: {
    originalDurationMs: number;
    speechDurationMs: number;
    removedMs: number;
    mode: 'silenceremove' | 'failed_fallback';
  };
}

/**
 * Transcribe audio file using whisper.cpp + VAD preprocessing
 * @param audioBuffer - Audio file buffer
 * @param filename - Original filename (for format detection)
 * @returns Transcription result
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string
): Promise<TranscriptionResult> {
  // Use concurrency limiter to prevent CPU meltdown
  return withTranscriptionSlot(async () => {
    const tempFile = join(tmpdir(), `transcribe-${Date.now()}-${filename}`);
    const cleanupFiles: string[] = [tempFile];

    try {
      // Write upload buffer to temp file
      fs.writeFileSync(tempFile, audioBuffer);

      // Step 1: Normalize audio to mono 16kHz WAV
      const { wavPath, durationMs } = await prepareWavForAsr(tempFile);
      cleanupFiles.push(wavPath);

      // Step 2: Apply VAD to remove silence
      const { vadWavPath, vadStats } = await applyVad(wavPath);
      cleanupFiles.push(vadWavPath);

      // Step 3: Run whisper.cpp on VAD-processed audio
      const whisperResult = await runWhisperCpp(vadWavPath);

      // Clean up temp files
      for (const file of cleanupFiles) {
        try {
          if (await fsExists(file)) {
            await fsUnlink(file);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Return result with backward-compatible fields
      return {
        transcript: whisperResult.text,
        text: whisperResult.text, // Alias for backward compatibility
        language: whisperResult.language || 'unknown',
        duration: Math.round(durationMs / 1000), // Duration in seconds (backward compat)
        durationMs, // New field
        segments: whisperResult.segments,
        vadStats,
      };
    } catch (error: any) {
      // Clean up temp files on error
      for (const file of cleanupFiles) {
        try {
          if (await fsExists(file)) {
            await fsUnlink(file);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      // Check if this is a concurrency limit error
      if (error.code === 'ASR_BUSY' || error.statusCode === 429) {
        throw error; // Let it propagate with 429 status
      }

      // Log error (but not transcript text for privacy)
      console.error('Transcription error:', error.message);
      
      throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
  });
}

/**
 * Validate audio file format
 */
export function isValidAudioFormat(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  const validFormats = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'opus', 'aac', 'ulaw', 'alaw'];
  return validFormats.includes(ext || '');
}

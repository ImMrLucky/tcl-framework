/**
 * Audio Transcription Service
 * Uses local Whisper model (free, self-contained, no API keys needed)
 * Powered by @xenova/transformers
 * 
 * Does not store audio files - only extracts and returns text
 */

import { pipeline } from '@xenova/transformers';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface TranscriptionResult {
  transcript: string;
  language?: string;
  duration?: number;
}

/**
 * Transcribe audio file using local Whisper model (FREE, self-contained)
 * @param audioBuffer - Audio file buffer
 * @param filename - Original filename (for format detection)
 * @returns Transcription result
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string
): Promise<TranscriptionResult> {
  try {
    // Save buffer to temp file (Whisper needs a file path)
    const tempFile = join(tmpdir(), `transcribe-${Date.now()}-${filename}`);
    fs.writeFileSync(tempFile, audioBuffer);

    try {
      // Load Whisper model (downloads on first use, ~1.5GB)
      // Uses 'Xenova/whisper-tiny' by default (fastest, smallest)
      // Can be overridden with WHISPER_MODEL env var
      const modelName = process.env.WHISPER_MODEL || 'Xenova/whisper-tiny';
      console.log(`Loading Whisper model: ${modelName}...`);
      
      const transcriber = await pipeline(
        'automatic-speech-recognition',
        modelName
      );

      console.log('Transcribing audio...');
      const result = await transcriber(tempFile, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });

      // Clean up temp file
      fs.unlinkSync(tempFile);

      // Handle result - can be object or array
      const transcriptionResult = Array.isArray(result) ? result[0] : result;
      
      return {
        transcript: (transcriptionResult as any).text || '',
        language: (transcriptionResult as any).language,
      };
    } catch (error) {
      // Clean up temp file on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Local transcription error:', error);
    throw new Error(`Failed to transcribe audio locally: ${error.message}`);
  }
}



/**
 * Validate audio file format
 */
export function isValidAudioFormat(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  const validFormats = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'opus', 'aac', 'ulaw', 'alaw'];
  return validFormats.includes(ext || '');
}


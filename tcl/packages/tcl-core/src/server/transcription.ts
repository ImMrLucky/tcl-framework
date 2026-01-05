/**
 * Audio Transcription Service
 * Uses local Whisper model (free, self-contained, no API keys needed)
 * Powered by @xenova/transformers (WASM mode - no native dependencies)
 * 
 * Does not store audio files - only extracts and returns text
 */

// CRITICAL: Set environment variables at module level BEFORE any imports
// This prevents onnxruntime-node from loading native bindings
// Required for Docker/container environments without native libraries
if (typeof process !== 'undefined' && process.env) {
  process.env.USE_WASM = '1';
  process.env.ONNXRUNTIME_EXECUTION_PROVIDERS = '';
  // Prevent onnxruntime-node from being used
  process.env.ONNXRUNTIME_DISABLE_NATIVE = '1';
  // Force transformers to use WASM only
  process.env.TRANSFORMERS_USE_WASM = '1';
  // Additional WASM-only flags
  process.env.USE_BROWSER = '0';
  process.env.USE_WASM_ONLY = '1';
}

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
      // Dynamic import - env vars are already set at module level
      // Wrap in try-catch to handle onnxruntime-node loading errors
      let pipeline: any;
      let env: any;
      
      try {
        const transformers = await import('@xenova/transformers');
        pipeline = transformers.pipeline;
        env = transformers.env;
      } catch (importError: any) {
        // If import fails due to onnxruntime-node, provide clearer error
        if (importError.message?.includes('onnxruntime') || importError.message?.includes('ld-linux')) {
          throw new Error(
            'Failed to load transformers library. The system is trying to use native onnxruntime-node bindings. ' +
            'Please ensure environment variables USE_WASM=1 and ONNXRUNTIME_DISABLE_NATIVE=1 are set before starting the server.'
          );
        }
        throw importError;
      }
      
      // Force WASM backend explicitly
      // This prevents errors in containers that don't have native libraries
      if (env) {
        // Disable any native backends
        if (env.backends) {
          if (env.backends.onnx) {
            // Force WASM-only mode
            env.backends.onnx.wasm.proxy = false;
            env.backends.onnx.wasm.numThreads = 1;
            // Disable native backend
            if (env.backends.onnx.native) {
              env.backends.onnx.native = undefined;
            }
          }
        }
        // Set default backend to WASM
        env.useBrowserCache = false;
        env.useCustomCache = false;
      }
      
      // Load Whisper model (downloads on first use, ~1.5GB)
      // Uses 'Xenova/whisper-tiny' by default (fastest, smallest)
      // Can be overridden with WHISPER_MODEL env var
      const modelName = process.env.WHISPER_MODEL || 'Xenova/whisper-tiny';
      console.log(`Loading Whisper model: ${modelName}...`);
      
      const transcriber = await pipeline(
        'automatic-speech-recognition',
        modelName,
        {
          quantized: true, // Use quantized model (smaller, faster)
        }
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


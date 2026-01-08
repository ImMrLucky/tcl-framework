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
    // Force WASM mode - must be set before any imports
    // TRANSFORMERS_BACKEND is the most critical variable
    process.env.TRANSFORMERS_BACKEND = 'wasm';
    process.env.USE_WASM = '1';
    process.env.ONNXRUNTIME_EXECUTION_PROVIDERS = '';
    process.env.ONNXRUNTIME_DISABLE_NATIVE = '1';
    process.env.TRANSFORMERS_USE_WASM = '1';
    process.env.USE_BROWSER = '0';
    process.env.USE_WASM_ONLY = '1';
    // Prevent onnxruntime-node from being loaded
    // This is critical for serverless environments
    process.env.ONNXRUNTIME_USE_WASM = '1';
    process.env.ONNXRUNTIME_USE_WEB = '1';
    // Block native module loading by monkey-patching require
    // This prevents onnxruntime-node from being loaded even if it's installed
    const originalRequire = global.require || global.Module?.require;
    if (originalRequire) {
        const patchedRequire = (id) => {
            if (id === 'onnxruntime-node' || id.includes('onnxruntime-node')) {
                throw new Error('onnxruntime-node is disabled - using WASM mode only');
            }
            return originalRequire(id);
        };
        // Try to patch if possible (may not work in all environments)
        try {
            if (global.Module) {
                global.Module.prototype.require = patchedRequire;
            }
        }
        catch (e) {
            // Ignore if patching fails
        }
    }
}
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
/**
 * Transcribe audio file using local Whisper model (FREE, self-contained)
 * @param audioBuffer - Audio file buffer
 * @param filename - Original filename (for format detection)
 * @returns Transcription result
 */
export async function transcribeAudio(audioBuffer, filename) {
    try {
        // CRITICAL: Verify WASM mode is enabled before proceeding
        // This prevents native library loading errors
        const requiredEnvVars = {
            USE_WASM: '1',
            ONNXRUNTIME_DISABLE_NATIVE: '1',
            TRANSFORMERS_USE_WASM: '1',
            USE_BROWSER: '0',
            USE_WASM_ONLY: '1',
        };
        // Set all required environment variables
        for (const [key, value] of Object.entries(requiredEnvVars)) {
            process.env[key] = value;
        }
        // Additional ONNX-specific vars
        process.env.ONNXRUNTIME_EXECUTION_PROVIDERS = '';
        process.env.ONNXRUNTIME_USE_WASM = '1';
        process.env.ONNXRUNTIME_USE_WEB = '1';
        // Verify critical vars are set (double-check)
        if (process.env.USE_WASM !== '1' || process.env.ONNXRUNTIME_DISABLE_NATIVE !== '1') {
            console.warn('WARNING: WASM environment variables may not be set correctly');
            console.warn('Current values:', {
                USE_WASM: process.env.USE_WASM,
                ONNXRUNTIME_DISABLE_NATIVE: process.env.ONNXRUNTIME_DISABLE_NATIVE,
                TRANSFORMERS_USE_WASM: process.env.TRANSFORMERS_USE_WASM,
            });
        }
        // Save buffer to temp file (Whisper needs a file path)
        const tempFile = join(tmpdir(), `transcribe-${Date.now()}-${filename}`);
        fs.writeFileSync(tempFile, audioBuffer);
        try {
            // CRITICAL: Set TRANSFORMERS_BACKEND before import (this is the key variable)
            process.env.TRANSFORMERS_BACKEND = 'wasm';
            // Double-check all critical variables are set
            const criticalVars = {
                USE_WASM: '1',
                ONNXRUNTIME_DISABLE_NATIVE: '1',
                TRANSFORMERS_USE_WASM: '1',
                TRANSFORMERS_BACKEND: 'wasm',
                USE_BROWSER: '0',
                USE_WASM_ONLY: '1',
                ONNXRUNTIME_EXECUTION_PROVIDERS: '',
                ONNXRUNTIME_USE_WASM: '1',
                ONNXRUNTIME_USE_WEB: '1',
            };
            for (const [key, value] of Object.entries(criticalVars)) {
                process.env[key] = value;
            }
            // Log current state for debugging
            console.log('Environment check before import:', {
                USE_WASM: process.env.USE_WASM,
                ONNXRUNTIME_DISABLE_NATIVE: process.env.ONNXRUNTIME_DISABLE_NATIVE,
                TRANSFORMERS_USE_WASM: process.env.TRANSFORMERS_USE_WASM,
                TRANSFORMERS_BACKEND: process.env.TRANSFORMERS_BACKEND,
            });
            // Dynamic import - env vars are already set at module level
            // @xenova/transformers should respect USE_WASM=1 and use WASM backend
            const { pipeline, env } = await import('@xenova/transformers');
            // Force WASM backend explicitly
            // This prevents errors in containers that don't have native libraries
            if (env) {
                // Explicitly set to use WASM only
                env.backends = env.backends || {};
                env.backends.onnx = env.backends.onnx || {};
                // Force WASM-only mode - disable native completely
                env.backends.onnx.wasm = env.backends.onnx.wasm || {};
                env.backends.onnx.wasm.proxy = false;
                env.backends.onnx.wasm.numThreads = 1;
                // Completely remove native backend
                delete env.backends.onnx.native;
                env.backends.onnx.native = undefined;
                // Set default backend to WASM
                env.useBrowserCache = false;
                env.useCustomCache = false;
                // Force WASM execution provider
                env.backends.onnx.executionProviders = ['wasm'];
            }
            // Load Whisper model (downloads on first use, ~1.5GB)
            // Uses 'Xenova/whisper-tiny' by default (fastest, smallest)
            // Can be overridden with WHISPER_MODEL env var
            const modelName = process.env.WHISPER_MODEL || 'Xenova/whisper-tiny';
            console.log(`Loading Whisper model: ${modelName}...`);
            console.log(`WASM mode: ${process.env.USE_WASM}, DISABLE_NATIVE: ${process.env.ONNXRUNTIME_DISABLE_NATIVE}`);
            // Create pipeline with explicit WASM-only configuration
            const transcriber = await pipeline('automatic-speech-recognition', modelName, {
                quantized: true, // Use quantized model (smaller, faster)
            });
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
                transcript: transcriptionResult.text || '',
                language: transcriptionResult.language,
            };
        }
        catch (error) {
            // Clean up temp file on error
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
            // Check if this is the onnxruntime-node native library error
            if (error.message && (error.message.includes('ld-linux-x86-64.so.2') ||
                error.message.includes('onnxruntime-node') ||
                error.message.includes('shared library'))) {
                // Check if environment variables are actually set
                const missingVars = [];
                if (process.env.USE_WASM !== '1')
                    missingVars.push('USE_WASM=1');
                if (process.env.ONNXRUNTIME_DISABLE_NATIVE !== '1')
                    missingVars.push('ONNXRUNTIME_DISABLE_NATIVE=1');
                if (process.env.TRANSFORMERS_USE_WASM !== '1')
                    missingVars.push('TRANSFORMERS_USE_WASM=1');
                if (process.env.TRANSFORMERS_BACKEND !== 'wasm')
                    missingVars.push('TRANSFORMERS_BACKEND=wasm');
                const envNote = missingVars.length > 0
                    ? `\n\nMissing environment variables: ${missingVars.join(', ')}\nPlease set these in your Railway dashboard (Variables tab) and redeploy.`
                    : '\n\nEnvironment variables appear to be set, but the library is still trying to load native modules. This may require a service restart or redeploy.';
                throw new Error('Audio transcription requires WASM mode but native libraries are being loaded. ' +
                    'This typically happens in serverless environments. ' +
                    'Please ensure these environment variables are set in Railway: USE_WASM=1, ONNXRUNTIME_DISABLE_NATIVE=1, TRANSFORMERS_USE_WASM=1, TRANSFORMERS_BACKEND=wasm' +
                    envNote);
            }
            throw error;
        }
    }
    catch (error) {
        console.error('Local transcription error:', error);
        // Provide helpful error message for native library issues
        if (error.message && (error.message.includes('ld-linux-x86-64.so.2') ||
            error.message.includes('onnxruntime-node') ||
            error.message.includes('shared library'))) {
            const currentVars = {
                USE_WASM: process.env.USE_WASM,
                ONNXRUNTIME_DISABLE_NATIVE: process.env.ONNXRUNTIME_DISABLE_NATIVE,
                TRANSFORMERS_USE_WASM: process.env.TRANSFORMERS_USE_WASM,
                TRANSFORMERS_BACKEND: process.env.TRANSFORMERS_BACKEND,
            };
            throw new Error('Audio transcription failed: Native library loading error. ' +
                'The transcription service requires WASM-only mode. ' +
                'Please set these environment variables in Railway: USE_WASM=1, ONNXRUNTIME_DISABLE_NATIVE=1, TRANSFORMERS_USE_WASM=1, TRANSFORMERS_BACKEND=wasm. ' +
                `Current values: ${JSON.stringify(currentVars)}. ` +
                'After setting variables, redeploy your Railway service.');
        }
        throw new Error(`Failed to transcribe audio locally: ${error.message}`);
    }
}
/**
 * Validate audio file format
 */
export function isValidAudioFormat(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    const validFormats = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'opus', 'aac', 'ulaw', 'alaw'];
    return validFormats.includes(ext || '');
}

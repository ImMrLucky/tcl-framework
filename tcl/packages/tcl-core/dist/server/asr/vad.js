/**
 * Voice Activity Detection (VAD) Preprocessing
 * Uses ffmpeg to remove silence and normalize audio for ASR
 */
import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
const fsExists = promisify(fs.exists);
const fsUnlink = promisify(fs.unlink);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const VAD_MODE = process.env.VAD_MODE || 'silenceremove';
const VAD_SILENCE_THRESHOLD_DB = parseFloat(process.env.VAD_SILENCE_THRESHOLD_DB || '-35');
const VAD_MIN_SILENCE_SEC = parseFloat(process.env.VAD_MIN_SILENCE_SEC || '0.35');
const VAD_KEEP_SILENCE_SEC = parseFloat(process.env.VAD_KEEP_SILENCE_SEC || '0.2');
/**
 * Normalize audio to mono 16kHz WAV format
 */
export async function prepareWavForAsr(inputPath) {
    const outputPath = join(tmpdir(), `normalized-${Date.now()}.wav`);
    return new Promise((resolve, reject) => {
        // Get duration first
        const probeProcess = spawn(FFMPEG_BIN, [
            '-i', inputPath,
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let durationMs = 0;
        let stderr = '';
        probeProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            // Parse duration from ffmpeg output: Duration: 00:01:23.45
            const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
            if (durationMatch) {
                const hours = parseInt(durationMatch[1], 10);
                const minutes = parseInt(durationMatch[2], 10);
                const seconds = parseInt(durationMatch[3], 10);
                const centiseconds = parseInt(durationMatch[4], 10);
                durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + centiseconds * 10;
            }
        });
        probeProcess.on('close', (code) => {
            if (code !== 0 && code !== 1) {
                // ffmpeg returns 1 for some info commands, so we check stderr for actual errors
                if (!stderr.includes('Duration:')) {
                    reject(new Error(`ffmpeg probe failed: ${stderr}`));
                    return;
                }
            }
            // Now normalize the audio
            const normalizeProcess = spawn(FFMPEG_BIN, [
                '-i', inputPath,
                '-ac', '1', // mono
                '-ar', '16000', // 16kHz sample rate
                '-f', 'wav',
                '-y', // overwrite output
                outputPath
            ], { stdio: ['ignore', 'pipe', 'pipe'] });
            let normalizeStderr = '';
            normalizeProcess.stderr.on('data', (data) => {
                normalizeStderr += data.toString();
            });
            normalizeProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`ffmpeg normalization failed: ${normalizeStderr}`));
                    return;
                }
                resolve({ wavPath: outputPath, durationMs });
            });
            normalizeProcess.on('error', (error) => {
                reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
            });
        });
        probeProcess.on('error', (error) => {
            reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
        });
    });
}
/**
 * Apply VAD (Voice Activity Detection) to remove silence
 */
export async function applyVad(wavPath) {
    const vadWavPath = join(tmpdir(), `vad-${Date.now()}.wav`);
    // Get original duration
    const { durationMs: originalDurationMs } = await prepareWavForAsr(wavPath);
    if (VAD_MODE === 'silenceremove') {
        try {
            // Apply silenceremove filter
            // silenceremove=start_periods=1:start_duration=0:start_threshold=-35dB:stop_periods=-1:stop_duration=0.35:stop_threshold=-35dB
            const filter = `silenceremove=start_periods=1:start_duration=0:start_threshold=${VAD_SILENCE_THRESHOLD_DB}dB:stop_periods=-1:stop_duration=${VAD_MIN_SILENCE_SEC}:stop_threshold=${VAD_SILENCE_THRESHOLD_DB}dB,apad=pad_dur=${VAD_KEEP_SILENCE_SEC}`;
            await new Promise((resolve, reject) => {
                const process = spawn(FFMPEG_BIN, [
                    '-i', wavPath,
                    '-af', filter,
                    '-f', 'wav',
                    '-y',
                    vadWavPath
                ], { stdio: ['ignore', 'pipe', 'pipe'] });
                let stderr = '';
                process.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
                process.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(`VAD processing failed: ${stderr}`));
                        return;
                    }
                    resolve();
                });
                process.on('error', (error) => {
                    reject(new Error(`Failed to spawn ffmpeg for VAD: ${error.message}`));
                });
            });
            // Get speech duration (reuse the VAD output, just get its duration)
            const getDurationProcess = spawn(FFMPEG_BIN, [
                '-i', vadWavPath,
                '-f', 'null',
                '-'
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            let speechDurationMs = originalDurationMs; // Default fallback
            let durationStderr = '';
            getDurationProcess.stderr.on('data', (data) => {
                durationStderr += data.toString();
                const match = durationStderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                if (match) {
                    const hours = parseInt(match[1], 10);
                    const minutes = parseInt(match[2], 10);
                    const seconds = parseInt(match[3], 10);
                    const centiseconds = parseInt(match[4], 10);
                    speechDurationMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + centiseconds * 10;
                }
            });
            await new Promise((resolve) => {
                getDurationProcess.on('close', () => resolve());
                getDurationProcess.on('error', () => resolve()); // Ignore errors, use fallback
            });
            const removedMs = originalDurationMs - speechDurationMs;
            return {
                vadWavPath,
                vadStats: {
                    originalDurationMs,
                    speechDurationMs,
                    removedMs: Math.max(0, removedMs),
                    mode: 'silenceremove',
                },
            };
        }
        catch (error) {
            console.warn('VAD processing failed, falling back to non-VAD audio:', error.message);
            // Fallback: copy original wav
            fs.copyFileSync(wavPath, vadWavPath);
            return {
                vadWavPath,
                vadStats: {
                    originalDurationMs,
                    speechDurationMs: originalDurationMs,
                    removedMs: 0,
                    mode: 'failed_fallback',
                },
            };
        }
    }
    else {
        // No VAD, just copy the file
        fs.copyFileSync(wavPath, vadWavPath);
        return {
            vadWavPath,
            vadStats: {
                originalDurationMs,
                speechDurationMs: originalDurationMs,
                removedMs: 0,
                mode: 'failed_fallback',
            },
        };
    }
}

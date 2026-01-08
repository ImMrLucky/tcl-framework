/**
 * Whisper.cpp ASR Runner
 * Executes whisper.cpp binary and parses output
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const fsReadFile = promisify(fs.readFile);
const fsUnlink = promisify(fs.unlink);
const fsExists = promisify(fs.exists);

export interface WhisperSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface WhisperResult {
  text: string;
  language: string | null;
  segments?: WhisperSegment[];
}

const WHISPERCPP_BIN = process.env.WHISPERCPP_BIN || './vendor/whispercpp/main';
const WHISPERCPP_MODEL = process.env.WHISPERCPP_MODEL || './models/ggml-base.en.bin';
const WHISPERCPP_THREADS = parseInt(process.env.WHISPERCPP_THREADS || '2', 10);
const WHISPERCPP_LANGUAGE = process.env.WHISPERCPP_LANGUAGE || 'en';
const WHISPERCPP_ARGS = process.env.WHISPERCPP_ARGS || '';

/**
 * Run whisper.cpp on an audio file
 */
export async function runWhisperCpp(audioPath: string): Promise<WhisperResult> {
  const outputBase = join(tmpdir(), `whisper-${Date.now()}`);
  const outputJson = `${outputBase}.json`;
  const outputTxt = `${outputBase}.txt`;

  // Build command args
  const args: string[] = [
    '-m', WHISPERCPP_MODEL,
    '-f', audioPath,
    '-t', WHISPERCPP_THREADS.toString(),
    '-l', WHISPERCPP_LANGUAGE,
    '-oj',                    // JSON output
    '-of', outputBase,        // Output base path
  ];

  // Add extra args if provided
  if (WHISPERCPP_ARGS) {
    args.push(...WHISPERCPP_ARGS.split(/\s+/).filter(arg => arg.length > 0));
  }

  // Log command at debug level
  if (process.env.DEBUG_ASR === '1') {
    console.log(`[ASR] Running whisper.cpp: ${WHISPERCPP_BIN} ${args.join(' ')}`);
  }

  return new Promise((resolve, reject) => {
    const process = spawn(WHISPERCPP_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    process.on('close', async (code, signal) => {
      try {
        // Check if output files were created even if process was killed
        // Sometimes whisper.cpp creates the output before being terminated
        const hasOutput = await fsExists(outputJson) || await fsExists(outputTxt);
        
        // If process was killed but we have output, try to use it
        if (code === null && hasOutput) {
          console.warn(`whisper.cpp process was terminated (signal: ${signal}), but output files exist. Attempting to read...`);
          // Continue to try reading the output files below
        } else if (code === null || (code !== 0 && !hasOutput)) {
          const errorMsg = code === null 
            ? `whisper.cpp process was terminated (signal: ${signal || 'unknown'}). This may indicate a timeout or resource limit. Try reducing audio length or using a smaller model. Output: ${stderr.substring(0, 500)}`
            : `whisper.cpp failed with code ${code}: ${stderr.substring(0, 500)}`;
          reject(new Error(errorMsg));
          return;
        }

        // Try to read JSON output first
        let result: WhisperResult;
        if (await fsExists(outputJson)) {
          const jsonContent = await fsReadFile(outputJson, 'utf-8');
          const jsonData = JSON.parse(jsonContent);
          
          // Parse whisper.cpp JSON format
          // whisper.cpp JSON format: { "transcription": [ { "text": "...", "timestamps": { "from": 0.0, "to": 1.5 } } ] }
          let text = '';
          const segments: WhisperSegment[] = [];

          if (Array.isArray(jsonData.transcription)) {
            for (const seg of jsonData.transcription) {
              const segmentText = (seg.text || '').trim();
              if (segmentText) {
                text += segmentText + ' ';
                
                // Parse timestamps (whisper.cpp uses "timestamps" or "offsets")
                const timestamps = seg.timestamps || seg.offsets || {};
                const start = timestamps.from || timestamps.start || 0;
                const end = timestamps.to || timestamps.end || start;
                
                segments.push({
                  startMs: Math.round(start * 1000),
                  endMs: Math.round(end * 1000),
                  text: segmentText,
                });
              }
            }
            text = text.trim();
          } else if (jsonData.text) {
            // Simple text format
            text = jsonData.text;
          } else {
            // Fallback: read from txt file
            if (await fsExists(outputTxt)) {
              text = (await fsReadFile(outputTxt, 'utf-8')).trim();
            } else {
              text = stdout.trim();
            }
          }

          result = {
            text,
            language: jsonData.language || WHISPERCPP_LANGUAGE,
            segments: segments.length > 0 ? segments : undefined,
          };
        } else if (await fsExists(outputTxt)) {
          // Fallback to text output
          const text = (await fsReadFile(outputTxt, 'utf-8')).trim();
          result = {
            text,
            language: WHISPERCPP_LANGUAGE === 'auto' ? null : WHISPERCPP_LANGUAGE,
          };
        } else {
          // Parse from stdout
          const text = stdout.trim() || stderr.trim();
          result = {
            text,
            language: WHISPERCPP_LANGUAGE === 'auto' ? null : WHISPERCPP_LANGUAGE,
          };
        }

        // Clean up output files
        try {
          if (await fsExists(outputJson)) await fsUnlink(outputJson);
          if (await fsExists(outputTxt)) await fsUnlink(outputTxt);
        } catch (e) {
          // Ignore cleanup errors
        }

        resolve(result);
      } catch (error: any) {
        reject(new Error(`Failed to parse whisper.cpp output: ${error.message}`));
      }
    });

    process.on('error', (error) => {
      reject(new Error(`Failed to spawn whisper.cpp: ${error.message}. Make sure WHISPERCPP_BIN is set correctly.`));
    });
  });
}


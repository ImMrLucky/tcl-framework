/**
 * Tests for ASR transcription modules
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withTranscriptionSlot } from '../limit.js';
import * as fs from 'fs';
import { promisify } from 'util';

const fsExists = promisify(fs.exists);

// Mock whisper.cpp and VAD modules
vi.mock('../whispercpp.js', () => ({
  runWhisperCpp: vi.fn(),
}));

vi.mock('../vad.js', () => ({
  prepareWavForAsr: vi.fn(),
  applyVad: vi.fn(),
}));

describe('ASR Transcription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Concurrency Limiter', () => {
    it('should allow single concurrent transcription', async () => {
      const result = await withTranscriptionSlot(async () => {
        return 'transcript';
      });
      expect(result).toBe('transcript');
    });

    it('should limit concurrency to 1 by default', async () => {
      // Set max concurrency to 1
      process.env.ASR_MAX_CONCURRENCY = '1';

      let firstStarted = false;
      let firstFinished = false;

      const first = withTranscriptionSlot(async () => {
        firstStarted = true;
        await new Promise(resolve => setTimeout(resolve, 100));
        firstFinished = true;
        return 'first';
      });

      // Start second immediately (should wait)
      const second = withTranscriptionSlot(async () => {
        expect(firstFinished).toBe(true);
        return 'second';
      });

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult).toBe('first');
      expect(secondResult).toBe('second');
    });

    it('should return 429 when all slots are busy', async () => {
      process.env.ASR_MAX_CONCURRENCY = '1';

      // Start a long-running task
      const longTask = withTranscriptionSlot(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'done';
      });

      // Try to start another immediately (should fail with 429)
      try {
        await withTranscriptionSlot(async () => {
          return 'should not run';
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.code).toBe('ASR_BUSY');
        expect(error.statusCode).toBe(429);
      }

      await longTask;
    });
  });

  describe('Transcription Integration', () => {
    it('should transcribe audio with VAD preprocessing', async () => {
      const { transcribeAudio } = await import('../../transcription.js');
      const { prepareWavForAsr, applyVad } = await import('../vad.js');
      const { runWhisperCpp } = await import('../whispercpp.js');

      // Mock VAD functions
      vi.mocked(prepareWavForAsr).mockResolvedValue({
        wavPath: '/tmp/normalized.wav',
        durationMs: 5000,
      });

      vi.mocked(applyVad).mockResolvedValue({
        vadWavPath: '/tmp/vad.wav',
        vadStats: {
          originalDurationMs: 5000,
          speechDurationMs: 3000,
          removedMs: 2000,
          mode: 'silenceremove',
        },
      });

      // Mock whisper.cpp
      vi.mocked(runWhisperCpp).mockResolvedValue({
        text: 'Hello world',
        language: 'en',
        segments: [
          { startMs: 0, endMs: 1000, text: 'Hello' },
          { startMs: 1000, endMs: 2000, text: 'world' },
        ],
      });

      const audioBuffer = Buffer.from('fake audio data');
      const result = await transcribeAudio(audioBuffer, 'test.wav');

      expect(result.transcript).toBe('Hello world');
      expect(result.text).toBe('Hello world');
      expect(result.language).toBe('en');
      expect(result.durationMs).toBe(5000);
      expect(result.vadStats?.mode).toBe('silenceremove');
      expect(result.segments).toHaveLength(2);
    });

    it('should handle VAD fallback gracefully', async () => {
      const { transcribeAudio } = await import('../../transcription.js');
      const { prepareWavForAsr, applyVad } = await import('../vad.js');
      const { runWhisperCpp } = await import('../whispercpp.js');

      vi.mocked(prepareWavForAsr).mockResolvedValue({
        wavPath: '/tmp/normalized.wav',
        durationMs: 5000,
      });

      vi.mocked(applyVad).mockResolvedValue({
        vadWavPath: '/tmp/vad.wav',
        vadStats: {
          originalDurationMs: 5000,
          speechDurationMs: 5000,
          removedMs: 0,
          mode: 'failed_fallback',
        },
      });

      vi.mocked(runWhisperCpp).mockResolvedValue({
        text: 'Test transcript',
        language: 'en',
      });

      const audioBuffer = Buffer.from('fake audio data');
      const result = await transcribeAudio(audioBuffer, 'test.wav');

      expect(result.transcript).toBe('Test transcript');
      expect(result.vadStats?.mode).toBe('failed_fallback');
    });
  });
});


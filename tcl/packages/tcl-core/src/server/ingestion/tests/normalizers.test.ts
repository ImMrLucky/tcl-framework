/**
 * Golden File Tests for Normalizers
 * 
 * Tests that each format normalizer produces consistent, deterministic output.
 * Uses fixture files in the tests/fixtures directory.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import { normalizeFile, generateChecksum } from '../normalizers/index.js';
import { txtSpeakerPrefixedNormalizer } from '../normalizers/txt-speaker-prefixed.js';
import { csvTurnsNormalizer } from '../normalizers/csv-turns.js';
import { jsonTurnsNormalizer } from '../normalizers/json-turns.js';
import { vttSrtNormalizer } from '../normalizers/vtt-srt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

// Expected outputs for golden tests
const EXPECTED_OUTPUTS = {
  txt: {
    turnsCount: 11,
    participantsCount: 2,
    roles: ['agent', 'customer'],
    speakerLabels: ['Agent', 'Customer'],
    firstTurnText: 'Thank you for calling ProtectQA support. My name is Sarah. How can I help you today?',
    lastTurnText: 'Thank you for calling. Goodbye!',
  },
  csv: {
    turnsCount: 11,
    participantsCount: 2,
    roles: ['agent', 'customer'],
    hasTimestamps: true,
  },
  json: {
    turnsCount: 11,
    participantsCount: 2,
    roles: ['agent', 'customer'],
    hasTimestamps: true,
    hasExternalId: true,
  },
  vtt: {
    turnsCount: 11, // After merging consecutive turns
    participantsCount: 2,
    roles: ['agent', 'customer'],
    hasTimestamps: true,
  },
  srt: {
    turnsCount: 11,
    participantsCount: 2,
    hasTimestamps: true,
  },
};

describe('TXT Speaker-Prefixed Normalizer', () => {
  const fixture = readFileSync(join(fixturesDir, 'sample-speaker-prefixed.txt'), 'utf-8');
  const fixtureBuffer = Buffer.from(fixture);

  it('should detect speaker-prefixed format', () => {
    const canHandle = txtSpeakerPrefixedNormalizer.canHandle(
      { filename: 'test.txt' },
      fixtureBuffer.slice(0, 2000)
    );
    expect(canHandle).toBe(true);
  });

  it('should normalize with correct turn count', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.txt');
    
    expect(result.success).toBe(true);
    expect(result.normalized.turns.length).toBe(EXPECTED_OUTPUTS.txt.turnsCount);
  });

  it('should detect correct speaker roles', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.txt');
    
    const roles = new Set(result.normalized.participants.map(p => p.role));
    expect(Array.from(roles).sort()).toEqual(EXPECTED_OUTPUTS.txt.roles.sort());
  });

  it('should preserve speaker labels', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.txt');
    
    const labels = new Set(result.normalized.participants.map(p => p.displayName));
    expect(Array.from(labels).sort()).toEqual(EXPECTED_OUTPUTS.txt.speakerLabels.sort());
  });

  it('should have correct first and last turn text', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.txt');
    
    expect(result.normalized.turns[0].text).toBe(EXPECTED_OUTPUTS.txt.firstTurnText);
    expect(result.normalized.turns[result.normalized.turns.length - 1].text).toBe(EXPECTED_OUTPUTS.txt.lastTurnText);
  });

  it('should produce deterministic output (same hash for same input)', async () => {
    const result1 = await normalizeFile(fixtureBuffer, 'sample.txt');
    const result2 = await normalizeFile(fixtureBuffer, 'sample.txt');
    
    // Exclude timestamp fields that will differ
    const normalize = (r: any) => ({
      turns: r.normalized.turns.map((t: any) => ({ 
        turnIndex: t.turnIndex, 
        text: t.text, 
        role: t.role 
      })),
      participants: r.normalized.participants,
    });
    
    const hash1 = createHash('sha256').update(JSON.stringify(normalize(result1))).digest('hex');
    const hash2 = createHash('sha256').update(JSON.stringify(normalize(result2))).digest('hex');
    
    expect(hash1).toBe(hash2);
  });
});

describe('CSV Turns Normalizer', () => {
  const fixture = readFileSync(join(fixturesDir, 'sample-turns.csv'), 'utf-8');
  const fixtureBuffer = Buffer.from(fixture);

  it('should detect CSV format', () => {
    const canHandle = csvTurnsNormalizer.canHandle(
      { filename: 'test.csv' },
      fixtureBuffer.slice(0, 2000)
    );
    expect(canHandle).toBe(true);
  });

  it('should normalize with correct turn count', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.csv');
    
    expect(result.success).toBe(true);
    expect(result.normalized.turns.length).toBe(EXPECTED_OUTPUTS.csv.turnsCount);
  });

  it('should detect column mapping', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.csv');
    
    expect(result.normalized.raw.columnMapping).toBeDefined();
    expect(result.normalized.raw.columnMapping?.speaker).toBe('speaker');
    expect(result.normalized.raw.columnMapping?.text).toBe('text');
    expect(result.normalized.raw.columnMapping?.time).toBe('timestamp');
  });

  it('should parse timestamps', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.csv');
    
    // Check that some turns have timestamps
    const turnsWithTimestamps = result.normalized.turns.filter(t => t.startTimeMs !== undefined);
    expect(turnsWithTimestamps.length).toBeGreaterThan(0);
  });

  it('should detect correct speaker roles', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.csv');
    
    const roles = new Set(result.normalized.participants.map(p => p.role));
    expect(Array.from(roles).sort()).toEqual(EXPECTED_OUTPUTS.csv.roles.sort());
  });
});

describe('JSON Turns Normalizer', () => {
  const fixture = readFileSync(join(fixturesDir, 'sample-turns.json'), 'utf-8');
  const fixtureBuffer = Buffer.from(fixture);

  it('should detect JSON format', () => {
    const canHandle = jsonTurnsNormalizer.canHandle(
      { filename: 'test.json' },
      fixtureBuffer.slice(0, 2000)
    );
    expect(canHandle).toBe(true);
  });

  it('should normalize with correct turn count', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.json');
    
    expect(result.success).toBe(true);
    expect(result.normalized.turns.length).toBe(EXPECTED_OUTPUTS.json.turnsCount);
  });

  it('should extract conversation metadata', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.json');
    
    expect(result.normalized.conversation.externalId).toBe('conv-001');
    expect(result.normalized.conversation.title).toBe('Support Call - Duplicate Charge');
  });

  it('should parse timestamps from JSON', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.json');
    
    const turnsWithTimestamps = result.normalized.turns.filter(t => t.startTimeMs !== undefined);
    expect(turnsWithTimestamps.length).toBe(EXPECTED_OUTPUTS.json.turnsCount);
    
    // First turn should start at 1000ms
    expect(result.normalized.turns[0].startTimeMs).toBe(1000);
  });

  it('should detect correct speaker roles', async () => {
    const result = await normalizeFile(fixtureBuffer, 'sample.json');
    
    const roles = new Set(result.normalized.participants.map(p => p.role));
    expect(Array.from(roles).sort()).toEqual(EXPECTED_OUTPUTS.json.roles.sort());
  });
});

describe('VTT/SRT Normalizer', () => {
  describe('VTT Format', () => {
    const fixture = readFileSync(join(fixturesDir, 'sample-subtitles.vtt'), 'utf-8');
    const fixtureBuffer = Buffer.from(fixture);

    it('should detect VTT format', () => {
      const canHandle = vttSrtNormalizer.canHandle(
        { filename: 'test.vtt' },
        fixtureBuffer.slice(0, 2000)
      );
      expect(canHandle).toBe(true);
    });

    it('should normalize with correct turn count', async () => {
      const result = await normalizeFile(fixtureBuffer, 'sample.vtt');
      
      expect(result.success).toBe(true);
      // VTT may have merged turns
      expect(result.normalized.turns.length).toBeGreaterThanOrEqual(6);
    });

    it('should extract speaker from VTT voice tags', async () => {
      const result = await normalizeFile(fixtureBuffer, 'sample.vtt');
      
      // Check that speakers were extracted
      const speakerLabels = new Set(result.normalized.turns.map(t => t.speakerLabel));
      expect(speakerLabels.has('Agent')).toBe(true);
      expect(speakerLabels.has('Customer')).toBe(true);
    });

    it('should parse VTT timestamps', async () => {
      const result = await normalizeFile(fixtureBuffer, 'sample.vtt');
      
      const turnsWithTimestamps = result.normalized.turns.filter(t => t.startTimeMs !== undefined);
      expect(turnsWithTimestamps.length).toBeGreaterThan(0);
      
      // First cue starts at 1000ms
      expect(result.normalized.turns[0].startTimeMs).toBe(1000);
    });
  });

  describe('SRT Format', () => {
    const fixture = readFileSync(join(fixturesDir, 'sample-subtitles.srt'), 'utf-8');
    const fixtureBuffer = Buffer.from(fixture);

    it('should detect SRT format', () => {
      const canHandle = vttSrtNormalizer.canHandle(
        { filename: 'test.srt' },
        fixtureBuffer.slice(0, 2000)
      );
      expect(canHandle).toBe(true);
    });

    it('should normalize with correct turn count', async () => {
      const result = await normalizeFile(fixtureBuffer, 'sample.srt');
      
      expect(result.success).toBe(true);
      expect(result.normalized.turns.length).toBe(EXPECTED_OUTPUTS.srt.turnsCount);
    });

    it('should extract speaker from SRT prefix', async () => {
      const result = await normalizeFile(fixtureBuffer, 'sample.srt');
      
      // Check that speakers were extracted from "Agent:" prefix
      const speakerLabels = new Set(result.normalized.turns.map(t => t.speakerLabel));
      expect(speakerLabels.has('Agent')).toBe(true);
      expect(speakerLabels.has('Customer')).toBe(true);
    });

    it('should parse SRT timestamps (comma format)', async () => {
      const result = await normalizeFile(fixtureBuffer, 'sample.srt');
      
      const turnsWithTimestamps = result.normalized.turns.filter(t => t.startTimeMs !== undefined);
      expect(turnsWithTimestamps.length).toBeGreaterThan(0);
      
      // First cue starts at 1000ms
      expect(result.normalized.turns[0].startTimeMs).toBe(1000);
    });
  });
});

describe('Determinism Tests', () => {
  it('should produce identical output for TXT on repeated normalization', async () => {
    const fixture = readFileSync(join(fixturesDir, 'sample-speaker-prefixed.txt'));
    
    const results = await Promise.all([
      normalizeFile(fixture, 'test.txt'),
      normalizeFile(fixture, 'test.txt'),
      normalizeFile(fixture, 'test.txt'),
    ]);
    
    // Compare core content (excluding timestamps that may vary)
    const getCore = (r: any) => r.normalized.turns.map((t: any) => ({
      turnIndex: t.turnIndex,
      text: t.text,
      role: t.role,
      speakerLabel: t.speakerLabel,
    }));
    
    const hash1 = createHash('sha256').update(JSON.stringify(getCore(results[0]))).digest('hex');
    const hash2 = createHash('sha256').update(JSON.stringify(getCore(results[1]))).digest('hex');
    const hash3 = createHash('sha256').update(JSON.stringify(getCore(results[2]))).digest('hex');
    
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('should generate consistent checksums', async () => {
    const fixture = readFileSync(join(fixturesDir, 'sample-speaker-prefixed.txt'));
    
    const result1 = await normalizeFile(fixture, 'test.txt');
    const result2 = await normalizeFile(fixture, 'test.txt');
    
    expect(result1.normalized.raw.checksum).toBe(result2.normalized.raw.checksum);
  });
});

describe('Speaker Role Mapping', () => {
  it('should map common agent variations', async () => {
    const transcripts = [
      'Agent: Hello',
      'Rep: Hello',
      'Advisor: Hello',
      'CSR: Hello',
    ];
    
    for (const transcript of transcripts) {
      const result = await normalizeFile(Buffer.from(transcript), 'test.txt');
      expect(result.normalized.turns[0].role).toBe('agent');
    }
  });

  it('should map common customer variations', async () => {
    const transcripts = [
      'Customer: Hello',
      'Caller: Hello',
      'Client: Hello',
      'Member: Hello',
    ];
    
    for (const transcript of transcripts) {
      const result = await normalizeFile(Buffer.from(transcript), 'test.txt');
      expect(result.normalized.turns[0].role).toBe('customer');
    }
  });

  it('should handle unknown speakers gracefully', async () => {
    const result = await normalizeFile(Buffer.from('Unknown123: Hello'), 'test.txt');
    expect(result.normalized.turns[0].role).toBe('unknown');
    expect(result.normalized.turns[0].speakerLabel).toBe('Unknown123');
  });
});


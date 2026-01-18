/**
 * CSV Batch Parser for Batch Ingestion
 * 
 * Parses CSV files containing turn-level or conversation-level transcript data.
 * Supports multiple CSV contracts (turn-level recommended).
 */

import type { CanonicalTranscript, TranscriptSource } from '../canonical-transcript.js';
import { normalizeToCanonical } from '../canonical-transcript.js';
import { getBatchIngestionConfig } from '../batch-config.js';

export interface CsvParseResult {
  transcripts: CanonicalTranscript[];
  errors: Array<{
    row: number;
    error: string;
  }>;
}

/**
 * Parse a CSV file using the configured contracts
 */
export function parseCsvBatch(
  fileBuffer: Buffer,
  fileName: string
): CsvParseResult {
  const config = getBatchIngestionConfig();
  const transcripts: CanonicalTranscript[] = [];
  const errors: CsvParseResult['errors'] = [];
  
  const text = fileBuffer.toString('utf-8');
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  if (lines.length === 0) {
    errors.push({
      row: 0,
      error: 'CSV file is empty',
    });
    return { transcripts, errors };
  }
  
  // Parse header
  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map(h => h.trim().toLowerCase());
  
  // Detect contract
  const contract = detectCsvContract(headers, config.csv_contracts);
  
  if (!contract) {
    errors.push({
      row: 0,
      error: `No matching CSV contract found. Required columns: ${config.csv_contracts.map(c => c.required_columns.join(', ')).join(' OR ')}`,
    });
    return { transcripts, errors };
  }
  
  // Parse rows
  if (contract.type === 'turn_level') {
    return parseTurnLevelCsv(lines, headers, contract, fileName);
  } else {
    return parseConversationLevelCsv(lines, headers, contract, fileName);
  }
}

/**
 * Parse turn-level CSV (recommended)
 */
function parseTurnLevelCsv(
  lines: string[],
  headers: string[],
  contract: any,
  fileName: string
): CsvParseResult {
  const transcripts: CanonicalTranscript[] = [];
  const errors: CsvParseResult['errors'] = [];
  
  // Map headers to canonical names
  const headerMap: Record<string, string> = {};
  contract.required_columns.forEach((col: string) => {
    const canonical = contract.column_mapping?.[col] || col;
    const headerIndex = headers.findIndex(h => h === col.toLowerCase());
    if (headerIndex >= 0) {
      headerMap[canonical] = headers[headerIndex];
    }
  });
  
  // Group rows by conversation_id
  const conversations = new Map<string, Array<{ row: number; data: Record<string, string> }>>();
  
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    try {
      const values = parseCsvLine(row);
      const data: Record<string, string> = {};
      headers.forEach((header, index) => {
        data[header] = values[index] || '';
      });
      
      const conversationId = data[headerMap['conversation_id']] || `conv_${i}`;
      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, []);
      }
      conversations.get(conversationId)!.push({ row: i + 1, data });
    } catch (error: any) {
      errors.push({
        row: i + 1,
        error: `CSV parse error: ${error.message}`,
      });
    }
  }
  
  // Convert each conversation to canonical transcript
  for (const [conversationId, rows] of conversations.entries()) {
    try {
      // Sort by turn_index
      rows.sort((a, b) => {
        const aIndex = parseInt(a.data[headerMap['turn_index']] || '0', 10);
        const bIndex = parseInt(b.data[headerMap['turn_index']] || '0', 10);
        return aIndex - bIndex;
      });
      
      // Build turns
      const turns = rows.map((row, index) => ({
        t: index,
        speaker_raw: row.data[headerMap['speaker']] || null,
        text: row.data[headerMap['text']] || '',
        timestamp: row.data[headerMap['timestamp']] ? parseFloat(row.data[headerMap['timestamp']]) : undefined,
      }));
      
      // Create source
      const source: TranscriptSource = {
        provider: 'csv',
        file_name: fileName,
        metadata: {
          contract: contract.id,
          conversation_id: conversationId,
        },
      };
      
      // Create canonical transcript
      const transcript = normalizeToCanonical(
        {
          conversation_id: conversationId,
          turns,
        },
        source
      );
      
      transcripts.push(transcript);
    } catch (error: any) {
      errors.push({
        row: rows[0]?.row || 0,
        error: `Failed to create transcript for conversation ${conversationId}: ${error.message}`,
      });
    }
  }
  
  return { transcripts, errors };
}

/**
 * Parse conversation-level CSV
 */
function parseConversationLevelCsv(
  lines: string[],
  headers: string[],
  contract: any,
  fileName: string
): CsvParseResult {
  const transcripts: CanonicalTranscript[] = [];
  const errors: CsvParseResult['errors'] = [];
  
  // Find transcript_text column
  const transcriptCol = headers.findIndex(h => h === 'transcript_text');
  const conversationIdCol = headers.findIndex(h => h === 'conversation_id');
  
  if (transcriptCol < 0) {
    errors.push({
      row: 0,
      error: 'Missing required column: transcript_text',
    });
    return { transcripts, errors };
  }
  
  // Parse each row as a separate conversation
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    try {
      const values = parseCsvLine(row);
      const conversationId = conversationIdCol >= 0 ? values[conversationIdCol] : `conv_${i}`;
      const transcriptText = values[transcriptCol] || '';
      
      if (!transcriptText.trim()) {
        errors.push({
          row: i + 1,
          error: 'Empty transcript_text',
        });
        continue;
      }
      
      // Split transcript into turns heuristically
      const lines = transcriptText.split('\n').filter(l => l.trim().length > 0);
      const turns = lines.map((line, index) => {
        // Try to extract speaker prefix
        const speakerMatch = line.match(/^([A-Za-z_0-9]+):\s*(.+)$/);
        return {
          t: index,
          speaker_raw: speakerMatch ? speakerMatch[1] : null,
          text: speakerMatch ? speakerMatch[2].trim() : line.trim(),
        };
      });
      
      const source: TranscriptSource = {
        provider: 'csv',
        file_name: fileName,
        metadata: {
          contract: contract.id,
          conversation_id: conversationId,
        },
      };
      
      const transcript = normalizeToCanonical(
        {
          conversation_id: conversationId,
          turns,
        },
        source
      );
      
      transcripts.push(transcript);
    } catch (error: any) {
      errors.push({
        row: i + 1,
        error: `CSV parse error: ${error.message}`,
      });
    }
  }
  
  return { transcripts, errors };
}

/**
 * Detect which CSV contract matches the headers
 */
function detectCsvContract(headers: string[], contracts: any[]): any {
  for (const contract of contracts) {
    const required = contract.required_columns.map((c: string) => c.toLowerCase());
    if (required.every((col: string) => headers.includes(col))) {
      return contract;
    }
  }
  return null;
}

/**
 * Parse a CSV line (handles quoted fields)
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  values.push(current);
  
  return values;
}


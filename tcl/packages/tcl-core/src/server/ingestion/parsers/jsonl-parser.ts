/**
 * JSONL (Newline-Delimited JSON) Parser for Batch Ingestion
 * 
 * Parses JSONL files where each line is a JSON object representing a transcript.
 * Supports both canonical schema and minimal schema.
 */

import type { CanonicalTranscript, TranscriptSource } from '../canonical-transcript.js';
import { normalizeToCanonical, validateCanonicalTranscript } from '../canonical-transcript.js';
import { getBatchIngestionConfig } from '../batch-config.js';

export interface JsonlParseResult {
  transcripts: CanonicalTranscript[];
  errors: Array<{
    line: number;
    error: string;
  }>;
}

/**
 * Parse a JSONL file
 */
export function parseJsonlBatch(
  fileBuffer: Buffer,
  fileName: string
): JsonlParseResult {
  const config = getBatchIngestionConfig();
  const transcripts: CanonicalTranscript[] = [];
  const errors: JsonlParseResult['errors'] = [];
  
  const text = fileBuffer.toString('utf-8');
  const lines = text.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (line.length === 0) {
      continue;
    }
    
    try {
      // Parse JSON line
      const json = JSON.parse(line);
      
      // Create source
      const source: TranscriptSource = {
        provider: 'jsonl',
        file_name: fileName,
        line_number: i + 1,
      };
      
      // Check if already in canonical format
      if (config.jsonl_config.accept_canonical && validateCanonicalTranscript(json)) {
        transcripts.push({
          ...json,
          source,
        });
        continue;
      }
      
      // Try minimal schema
      if (config.jsonl_config.accept_minimal) {
        const minimalFields = config.jsonl_config.minimal_schema_fields || {
          text: 'text',
          speaker: 'speaker',
          conversation_id: 'conversation_id',
        };
        
        const textField = json[minimalFields.text];
        if (!textField || typeof textField !== 'string') {
          errors.push({
            line: i + 1,
            error: `Missing or invalid '${minimalFields.text}' field`,
          });
          continue;
        }
        
        // Convert minimal schema to canonical
        const conversationId = minimalFields.conversation_id ? json[minimalFields.conversation_id] : undefined;
        const speaker = minimalFields.speaker ? json[minimalFields.speaker] : undefined;
        
        const normalized = normalizeToCanonical(
          {
            conversation_id: conversationId || `jsonl_line_${i + 1}`,
            text: textField,
            speaker: speaker,
          },
          source
        );
        
        transcripts.push(normalized);
        continue;
      }
      
      // Try to normalize as generic JSON
      const normalized = normalizeToCanonical(json, source);
      transcripts.push(normalized);
      
    } catch (error: any) {
      errors.push({
        line: i + 1,
        error: `JSON parse error: ${error.message}`,
      });
    }
  }
  
  return { transcripts, errors };
}


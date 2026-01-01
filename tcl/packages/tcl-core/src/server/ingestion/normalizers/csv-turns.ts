/**
 * CSV Turns Normalizer
 * 
 * Parses CSV files with turn-based data.
 * Automatically detects column mappings for speaker, text, and time.
 * 
 * Supported column variations:
 *   Speaker: speaker, agent, role, participant, author, from, sender
 *   Text: text, utterance, message, content, transcript, body
 *   Time: timestamp, time, start, start_ms, startTime, end_ms
 */

import {
  Normalizer,
  NormalizerOptions,
  NormalizerResult,
  NormalizedConversation,
  Turn,
  Participant,
  NORMALIZED_SCHEMA_VERSION,
  mapSpeakerToRole,
  generateChecksum,
  detectCSVColumnMapping,
} from "../types.js";

/**
 * Simple CSV parser (handles quoted fields)
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Parse time string to milliseconds
 */
function parseTimeToMs(timeStr: string): number | undefined {
  if (!timeStr) return undefined;
  
  // Try parsing as number (already in ms)
  const num = parseFloat(timeStr);
  if (!isNaN(num) && num > 0) {
    // If number is small, assume seconds
    if (num < 100000) {
      return Math.round(num * 1000);
    }
    return Math.round(num);
  }
  
  // Try parsing as HH:MM:SS or MM:SS
  const timeParts = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?$/);
  if (timeParts) {
    const hours = timeParts[3] ? parseInt(timeParts[1], 10) : 0;
    const minutes = timeParts[3] ? parseInt(timeParts[2], 10) : parseInt(timeParts[1], 10);
    const seconds = timeParts[3] ? parseInt(timeParts[3], 10) : parseInt(timeParts[2], 10);
    const ms = timeParts[4] ? parseInt(timeParts[4].padEnd(3, "0"), 10) : 0;
    
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;
  }
  
  // Try parsing as ISO date
  try {
    const date = new Date(timeStr);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  } catch {
    // Ignore
  }
  
  return undefined;
}

export class CSVTurnsNormalizer implements Normalizer {
  name = "csv-turns";
  extensions = [".csv"];
  
  canHandle(fileMeta: { filename: string; mimeType?: string }, headBytes: Buffer): boolean {
    const ext = fileMeta.filename.toLowerCase();
    if (!ext.endsWith(".csv")) return false;
    
    // Verify it looks like CSV
    const head = headBytes.toString("utf-8").substring(0, 2000);
    const lines = head.split("\n").filter(l => l.trim());
    
    if (lines.length < 2) return false;
    
    // Check for headers that suggest conversation data
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const mapping = detectCSVColumnMapping(headers);
    
    // Must have at least a text column
    return !!mapping.text;
  }
  
  async normalize(content: Buffer | string, options: NormalizerOptions): Promise<NormalizerResult> {
    const text = typeof content === "string" ? content : content.toString("utf-8");
    const lines = text.split("\n").filter(l => l.trim());
    const warnings: string[] = [];
    
    if (lines.length < 2) {
      return {
        normalized: this.createEmptyConversation(content),
        warnings: ["CSV has no data rows"],
        success: false,
      };
    }
    
    // Parse header
    const headers = parseCSVLine(lines[0]);
    const mapping = detectCSVColumnMapping(headers);
    
    if (!mapping.text) {
      warnings.push("Could not detect text column; using first non-header column");
    }
    
    if (mapping.ambiguous) {
      warnings.push("Column mapping is ambiguous; results may be inaccurate");
    }
    
    // Find column indices
    const speakerIdx = mapping.speaker ? headers.indexOf(mapping.speaker) : -1;
    const textIdx = mapping.text ? headers.indexOf(mapping.text) : 1; // Default to second column
    const timeIdx = mapping.time ? headers.indexOf(mapping.time) : -1;
    
    const turns: Turn[] = [];
    const participantsMap = new Map<string, Participant>();
    let charOffset = lines[0].length + 1;
    
    for (let i = 1; i < lines.length; i++) {
      const lineNumber = i + 1;
      const row = parseCSVLine(lines[i]);
      
      const turnText = row[textIdx]?.trim();
      if (!turnText) continue;
      
      const rawSpeaker = speakerIdx >= 0 ? row[speakerIdx]?.trim() : undefined;
      const timeStr = timeIdx >= 0 ? row[timeIdx]?.trim() : undefined;
      
      // Determine speaker role
      let role = options.speakerOverrides?.[rawSpeaker || ""];
      let mappingDecision = role ? `override: ${role}` : undefined;
      
      if (!role && rawSpeaker) {
        const speakerMapping = mapSpeakerToRole(rawSpeaker);
        role = speakerMapping.role;
        mappingDecision = speakerMapping.mappingDecision;
      } else if (!role) {
        role = "unknown";
        mappingDecision = "no speaker column";
      }
      
      // Create or get participant
      const participantId = this.getOrCreateParticipant(
        participantsMap,
        rawSpeaker || "Unknown",
        role!
      );
      
      const startTimeMs = parseTimeToMs(timeStr || "");
      
      const turn: Turn = {
        turnIndex: turns.length,
        participantId,
        role: role!,
        speakerLabel: rawSpeaker || "Unknown",
        text: turnText,
        lineStart: lineNumber,
        lineEnd: lineNumber,
        charStart: charOffset,
        charEnd: charOffset + lines[i].length,
        startTimeMs,
        meta: {
          rawSpeaker,
          rawFields: Object.fromEntries(headers.map((h, idx) => [h, row[idx]])),
          mappingDecision,
        },
      };
      
      turns.push(turn);
      charOffset += lines[i].length + 1;
    }
    
    const normalized: NormalizedConversation = {
      schemaVersion: NORMALIZED_SCHEMA_VERSION,
      channel: "call",
      sourceFormat: "csv",
      language: options.defaultLanguage || "en",
      timezone: options.defaultTimezone || "UTC",
      conversation: {},
      participants: Array.from(participantsMap.values()),
      turns,
      attachments: [],
      raw: {
        checksum: generateChecksum(content),
        byteSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
        ingestedAt: new Date().toISOString(),
        originalFilename: "",
        encoding: "utf-8",
        columnMapping: {
          speaker: mapping.speaker,
          text: mapping.text,
          time: mapping.time,
        },
        heuristicsApplied: ["csv-column-detection"],
      },
    };
    
    return {
      normalized,
      warnings,
      success: turns.length > 0,
    };
  }
  
  private getOrCreateParticipant(
    map: Map<string, Participant>,
    displayName: string,
    role: string
  ): string {
    // Look for existing participant with same name
    for (const [id, p] of map) {
      if (p.displayName.toLowerCase() === displayName.toLowerCase()) {
        return id;
      }
    }
    
    // Create new participant
    const participantId = `p_${role}_${map.size + 1}`;
    map.set(participantId, {
      participantId,
      displayName,
      role: role as any,
    });
    
    return participantId;
  }
  
  private createEmptyConversation(content: Buffer | string): NormalizedConversation {
    return {
      schemaVersion: NORMALIZED_SCHEMA_VERSION,
      channel: "other",
      sourceFormat: "csv",
      language: "en",
      timezone: "UTC",
      conversation: {},
      participants: [],
      turns: [],
      attachments: [],
      raw: {
        checksum: generateChecksum(content),
        byteSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
        ingestedAt: new Date().toISOString(),
        originalFilename: "",
      },
    };
  }
}

export const csvTurnsNormalizer = new CSVTurnsNormalizer();


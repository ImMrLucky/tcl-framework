/**
 * TXT Speaker-Prefixed Normalizer
 * 
 * Parses transcripts in the format:
 *   Agent: Thank you for calling...
 *   Customer: Hi, I have a question...
 * 
 * Supports variations:
 *   - "Agent: text"
 *   - "AGENT: text"
 *   - "[Agent] text"
 *   - "Agent - text"
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
} from "../types.js";

/**
 * Regex patterns to detect speaker-prefixed lines
 */
const SPEAKER_PATTERNS = [
  // "Agent: text" or "Agent : text"
  /^([A-Za-z][A-Za-z0-9_ ]{0,30}):\s*(.+)$/,
  // "[Agent] text" or "[AGENT] text"
  /^\[([A-Za-z][A-Za-z0-9_ ]{0,30})\]\s*(.+)$/,
  // "Agent - text"
  /^([A-Za-z][A-Za-z0-9_ ]{0,30})\s*[-–—]\s*(.+)$/,
  // "(Agent) text"
  /^\(([A-Za-z][A-Za-z0-9_ ]{0,30})\)\s*(.+)$/,
];

/**
 * Detect if a line is a speaker-prefixed turn
 */
function parseSpeakerLine(line: string): { speaker: string; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  
  for (const pattern of SPEAKER_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { speaker: match[1].trim(), text: match[2].trim() };
    }
  }
  
  return null;
}

export class TxtSpeakerPrefixedNormalizer implements Normalizer {
  name = "txt-speaker-prefixed";
  extensions = [".txt"];
  
  canHandle(fileMeta: { filename: string; mimeType?: string }, headBytes: Buffer): boolean {
    const ext = fileMeta.filename.toLowerCase();
    if (!ext.endsWith(".txt")) return false;
    
    // Check if content has speaker-prefixed lines
    const head = headBytes.toString("utf-8").substring(0, 2000);
    const lines = head.split("\n").filter(l => l.trim());
    
    if (lines.length === 0) return false;
    
    // Count how many lines match speaker patterns
    let matchCount = 0;
    for (const line of lines.slice(0, 20)) {
      if (parseSpeakerLine(line)) {
        matchCount++;
      }
    }
    
    // At least 30% of first 20 lines should have speaker prefixes
    return matchCount >= Math.min(3, lines.length * 0.3);
  }
  
  async normalize(content: Buffer | string, options: NormalizerOptions): Promise<NormalizerResult> {
    const text = typeof content === "string" ? content : content.toString("utf-8");
    const lines = text.split("\n");
    const warnings: string[] = [];
    
    const turns: Turn[] = [];
    const participantsMap = new Map<string, Participant>();
    
    let currentTurn: { speaker: string; text: string; lineStart: number; charStart: number } | null = null;
    let charOffset = 0;
    
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const lineNumber = lineIdx + 1; // 1-indexed
      
      const parsed = parseSpeakerLine(line);
      
      if (parsed) {
        // Flush previous turn
        if (currentTurn) {
          const turn = this.createTurn(
            currentTurn,
            turns.length,
            participantsMap,
            options,
            charOffset - currentTurn.text.length
          );
          turns.push(turn);
        }
        
        // Start new turn
        currentTurn = {
          speaker: parsed.speaker,
          text: parsed.text,
          lineStart: lineNumber,
          charStart: charOffset,
        };
      } else if (currentTurn && line.trim()) {
        // Continuation of current turn
        currentTurn.text += " " + line.trim();
      }
      
      charOffset += line.length + 1; // +1 for newline
    }
    
    // Flush last turn
    if (currentTurn) {
      const turn = this.createTurn(
        currentTurn,
        turns.length,
        participantsMap,
        options,
        charOffset
      );
      turns.push(turn);
    }
    
    if (turns.length === 0) {
      // Fallback: treat entire content as single turn
      warnings.push("No speaker prefixes detected; treating as single-speaker blob");
      turns.push({
        turnIndex: 0,
        participantId: "p_unknown_1",
        role: "unknown",
        speakerLabel: "Speaker",
        text: text.trim(),
        lineStart: 1,
        lineEnd: lines.length,
        charStart: 0,
        charEnd: text.length,
        meta: {
          rawSpeaker: undefined,
          mappingDecision: "fallback: no speakers detected",
        },
      });
      participantsMap.set("p_unknown_1", {
        participantId: "p_unknown_1",
        displayName: "Speaker",
        role: "unknown",
      });
    }
    
    const normalized: NormalizedConversation = {
      schemaVersion: NORMALIZED_SCHEMA_VERSION,
      channel: "call",
      sourceFormat: "txt",
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
        heuristicsApplied: ["speaker-prefix-detection"],
      },
    };
    
    return {
      normalized,
      warnings,
      success: true,
    };
  }
  
  private createTurn(
    raw: { speaker: string; text: string; lineStart: number; charStart: number },
    turnIndex: number,
    participantsMap: Map<string, Participant>,
    options: NormalizerOptions,
    charEnd: number
  ): Turn {
    // Check for overrides
    let role = options.speakerOverrides?.[raw.speaker];
    let mappingDecision = role ? `override: ${role}` : undefined;
    
    if (!role) {
      const mapping = mapSpeakerToRole(raw.speaker);
      role = mapping.role;
      mappingDecision = mapping.mappingDecision;
    }
    
    // Create participant ID based on role
    const baseId = `p_${role}_`;
    let participantId = "";
    
    // Try to find existing participant with same role, or create new
    for (const [id, p] of participantsMap) {
      if (p.role === role && p.displayName.toLowerCase() === raw.speaker.toLowerCase()) {
        participantId = id;
        break;
      }
    }
    
    if (!participantId) {
      const count = Array.from(participantsMap.keys()).filter(k => k.startsWith(baseId)).length + 1;
      participantId = `${baseId}${count}`;
      participantsMap.set(participantId, {
        participantId,
        displayName: raw.speaker,
        role,
      });
    }
    
    return {
      turnIndex,
      participantId,
      role,
      speakerLabel: raw.speaker,
      text: raw.text,
      lineStart: raw.lineStart,
      lineEnd: raw.lineStart, // Single line for speaker-prefixed
      charStart: raw.charStart,
      charEnd,
      meta: {
        rawSpeaker: raw.speaker,
        mappingDecision,
      },
    };
  }
}

export const txtSpeakerPrefixedNormalizer = new TxtSpeakerPrefixedNormalizer();


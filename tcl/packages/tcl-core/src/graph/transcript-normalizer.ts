/**
 * Transcript Normalizer
 * 
 * Normalizes transcript text into structured turns with speaker information.
 * Preserves speaker labels and maps them to canonical roles.
 * 
 * Part B: Fix speaker attribution
 */

export type SpeakerType = "agent" | "customer" | "unknown";
export type SpeakerRole = "AGENT" | "CUSTOMER" | "MIXED" | "UNKNOWN";

export interface NormalizedTurn {
  turnIndex: number;
  speakerLabelRaw: string;
  speakerType: SpeakerType;
  text: string;
}

/**
 * Default speaker label mapping (configurable)
 */
const DEFAULT_AGENT_LABELS = [
  'AGENT', 'CSR', 'REP', 'REPRESENTATIVE', 'SUPPORT', 'ASSOCIATE', 'ADVISOR',
  'OPERATOR', 'SPECIALIST', 'CONSULTANT', 'SERVICE', 'STAFF', 'EMPLOYEE',
  'TEAM MEMBER', 'SALES', 'ACCOUNT MANAGER', 'ACCOUNT EXEC', 'AE', 'SDR', 'BDR',
  'INSIDE SALES', 'SUPERVISOR', 'MANAGER', 'LEAD', 'SENIOR', 'DIRECTOR'
];

const DEFAULT_CUSTOMER_LABELS = [
  'CUSTOMER', 'CALLER', 'CLIENT', 'MEMBER', 'PATIENT', 'USER', 'BUYER',
  'GUEST', 'VISITOR', 'SUBSCRIBER', 'PROSPECT', 'LEAD', 'PURCHASER'
];

/**
 * Normalize speaker label to canonical type
 */
function normalizeSpeakerLabel(rawLabel: string, agentLabels: string[] = DEFAULT_AGENT_LABELS, customerLabels: string[] = DEFAULT_CUSTOMER_LABELS): SpeakerType {
  const normalized = rawLabel.trim().toUpperCase();
  
  // Remove punctuation and extra spaces
  const cleaned = normalized.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Check agent labels
  for (const agentLabel of agentLabels) {
    if (cleaned === agentLabel || cleaned.startsWith(agentLabel + ' ') || cleaned.includes(' ' + agentLabel)) {
      return 'agent';
    }
  }
  
  // Check customer labels
  for (const customerLabel of customerLabels) {
    if (cleaned === customerLabel || cleaned.startsWith(customerLabel + ' ') || cleaned.includes(' ' + customerLabel)) {
      return 'customer';
    }
  }
  
  // Pattern matching for common variations
  if (/^AGENT\s*\d*$/i.test(cleaned) || /^REP\s*\d*$/i.test(cleaned) || /^CSR\s*\d*$/i.test(cleaned)) {
    return 'agent';
  }
  
  if (/^CUSTOMER\s*\d*$/i.test(cleaned) || /^CALLER\s*\d*$/i.test(cleaned) || /^CLIENT\s*\d*$/i.test(cleaned)) {
    return 'customer';
  }
  
  return 'unknown';
}

/**
 * Normalize transcript into structured turns
 * 
 * Input: Raw transcript string with speaker labels
 * Output: Array of normalized turns with speaker information
 */
export function normalizeTranscript(
  transcript: string,
  options?: {
    agentLabels?: string[];
    customerLabels?: string[];
  }
): NormalizedTurn[] {
  const agentLabels = options?.agentLabels || DEFAULT_AGENT_LABELS;
  const customerLabels = options?.customerLabels || DEFAULT_CUSTOMER_LABELS;
  
  const lines = transcript.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const turns: NormalizedTurn[] = [];
  let currentTurn: NormalizedTurn | null = null;
  let turnIndex = 0;
  
  for (const line of lines) {
    // Pattern 1: "Speaker: text" (most common)
    let match = line.match(/^([A-Za-z][A-Za-z0-9_ -]{0,30})\s*:\s*(.+)$/);
    if (match) {
      const rawSpeaker = match[1].trim();
      const text = match[2].trim();
      
      // Start new turn
      currentTurn = {
        turnIndex: turnIndex++,
        speakerLabelRaw: rawSpeaker,
        speakerType: normalizeSpeakerLabel(rawSpeaker, agentLabels, customerLabels),
        text: text,
      };
      turns.push(currentTurn);
      continue;
    }
    
    // Pattern 2: "[Speaker] text"
    match = line.match(/^\[([A-Za-z][A-Za-z0-9_ -]{0,30})\]\s*(.+)$/);
    if (match) {
      const rawSpeaker = match[1].trim();
      const text = match[2].trim();
      
      currentTurn = {
        turnIndex: turnIndex++,
        speakerLabelRaw: rawSpeaker,
        speakerType: normalizeSpeakerLabel(rawSpeaker, agentLabels, customerLabels),
        text: text,
      };
      turns.push(currentTurn);
      continue;
    }
    
    // Pattern 3: "Speaker - text" or "Speaker — text"
    match = line.match(/^([A-Za-z][A-Za-z0-9_ -]{0,30})\s*[-–—]\s*(.+)$/);
    if (match) {
      const rawSpeaker = match[1].trim();
      const text = match[2].trim();
      
      currentTurn = {
        turnIndex: turnIndex++,
        speakerLabelRaw: rawSpeaker,
        speakerType: normalizeSpeakerLabel(rawSpeaker, agentLabels, customerLabels),
        text: text,
      };
      turns.push(currentTurn);
      continue;
    }
    
    // Pattern 4: "(Speaker) text"
    match = line.match(/^\(([A-Za-z][A-Za-z0-9_ -]{0,30})\)\s*(.+)$/);
    if (match) {
      const rawSpeaker = match[1].trim();
      const text = match[2].trim();
      
      currentTurn = {
        turnIndex: turnIndex++,
        speakerLabelRaw: rawSpeaker,
        speakerType: normalizeSpeakerLabel(rawSpeaker, agentLabels, customerLabels),
        text: text,
      };
      turns.push(currentTurn);
      continue;
    }
    
    // Pattern 5: VTT format "<v Speaker>text"
    match = line.match(/^<v\s+([^>]+)>\s*(.*)$/i);
    if (match) {
      const rawSpeaker = match[1].trim();
      const text = match[2].trim();
      
      currentTurn = {
        turnIndex: turnIndex++,
        speakerLabelRaw: rawSpeaker,
        speakerType: normalizeSpeakerLabel(rawSpeaker, agentLabels, customerLabels),
        text: text,
      };
      turns.push(currentTurn);
      continue;
    }
    
    // Pattern 6: Numbered speakers "Speaker 1:", "Speaker 2:"
    match = line.match(/^(Speaker\s*\d+)\s*:\s*(.+)$/i);
    if (match) {
      const rawSpeaker = match[1].trim();
      const text = match[2].trim();
      
      currentTurn = {
        turnIndex: turnIndex++,
        speakerLabelRaw: rawSpeaker,
        speakerType: 'unknown', // Can't determine from numbered speakers alone
        text: text,
      };
      turns.push(currentTurn);
      continue;
    }
    
    // No speaker prefix: append to previous turn or create UNKNOWN turn
    if (currentTurn && line.length > 0) {
      // Append to previous turn
      currentTurn.text += ' ' + line;
    } else if (line.length > 10) {
      // Create new UNKNOWN turn
      currentTurn = {
        turnIndex: turnIndex++,
        speakerLabelRaw: 'UNKNOWN',
        speakerType: 'unknown',
        text: line,
      };
      turns.push(currentTurn);
    }
  }
  
  return turns;
}

/**
 * Convert SpeakerType to SpeakerRole (for IssueV2 compatibility)
 */
export function speakerTypeToRole(speakerType: SpeakerType): SpeakerRole {
  switch (speakerType) {
    case 'agent':
      return 'AGENT';
    case 'customer':
      return 'CUSTOMER';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Derive issue speaker from multiple claims
 */
export function deriveIssueSpeaker(claimSpeakers: Array<{ speakerType: SpeakerType; speakerLabel?: string }>): {
  speaker: SpeakerRole;
  speakerLabel?: string;
} {
  if (claimSpeakers.length === 0) {
    return { speaker: 'UNKNOWN' };
  }
  
  if (claimSpeakers.length === 1) {
    return {
      speaker: speakerTypeToRole(claimSpeakers[0].speakerType),
      speakerLabel: claimSpeakers[0].speakerLabel,
    };
  }
  
  // Multiple claims: check if all same type
  const types = new Set(claimSpeakers.map(c => c.speakerType));
  const labels = claimSpeakers.map(c => c.speakerLabel).filter(Boolean);
  
  if (types.size === 1) {
    // All same type
    const type = Array.from(types)[0];
    return {
      speaker: speakerTypeToRole(type),
      speakerLabel: labels[0] || undefined,
    };
  }
  
  // Mixed types
  return {
    speaker: 'MIXED',
    speakerLabel: labels.length > 0 ? labels.join(', ') : undefined,
  };
}


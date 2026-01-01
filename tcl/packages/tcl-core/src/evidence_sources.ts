/**
 * Evidence Source Generation
 * 
 * This module generates source chunks from normalized conversations for:
 * 1. Grounding claims to transcript evidence
 * 2. Retrieval-based NLI scoring
 * 3. Evidence attribution for issues
 * 
 * CRITICAL: Every conversation must generate sources, even without external documents.
 * Without sources, the NLI graph has no grounding and spectral analysis is meaningless.
 */

import { createHash } from "crypto";
import type { Source, Claim } from "./types.js";
import type { NormalizedConversation, Turn } from "./server/ingestion/types.js";

// =============================================================================
// TYPES
// =============================================================================

export interface TranscriptChunk extends Source {
  /** Turn index in normalized conversation */
  turnIndex: number;
  /** Chunk index within turn (for multi-sentence turns) */
  chunkIndex: number;
  /** Speaker role */
  role: string;
  /** Speaker label */
  speakerLabel: string;
  /** Start time in ms (for audio) */
  startTimeMs?: number;
  /** End time in ms */
  endTimeMs?: number;
  /** Participant ID */
  participantId: string;
  /** Character offsets */
  charStart?: number;
  charEnd?: number;
}

export interface EvidenceHit {
  /** Source chunk ID */
  sourceId: string;
  /** Source text */
  text: string;
  /** Similarity score (0-1) */
  similarity: number;
  /** Optional: turn index */
  turnIndex?: number;
  /** Optional: speaker */
  speaker?: string;
}

export interface ClaimEvidenceAttribution {
  /** Claim ID */
  claimId: string;
  /** Evidence hits with NLI scores */
  evidence: Array<{
    sourceId: string;
    text: string;
    nliScore: number;
    nliLabel: "ENTAILMENT" | "CONTRADICTION" | "NEUTRAL";
    turnIndex?: number;
    speaker?: string;
  }>;
}

// =============================================================================
// CHUNKING STRATEGIES
// =============================================================================

/**
 * Default chunk settings
 */
const CHUNK_CONFIG = {
  /** Target chunk size in characters */
  targetSize: 600,
  /** Maximum chunk size */
  maxSize: 900,
  /** Minimum chunk size (smaller chunks are merged with next) */
  minSize: 100,
  /** Overlap between chunks */
  overlap: 50
};

/**
 * Generate a stable ID for a transcript chunk
 */
export function generateChunkId(
  conversationId: string,
  turnIndex: number,
  chunkIndex: number
): string {
  const input = `chunk:${conversationId}:${turnIndex}:${chunkIndex}`;
  const hash = createHash("sha256").update(input).digest("hex").substring(0, 12);
  return `src_${hash}`;
}

/**
 * Split text into sentences (simple heuristic)
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Generate source chunks from a single turn
 * 
 * For short turns: one chunk per turn
 * For long turns: split into overlapping chunks
 */
function chunkTurn(
  turn: Turn,
  conversationId: string,
  config = CHUNK_CONFIG
): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  const text = turn.text.trim();
  
  if (text.length === 0) return chunks;
  
  // Short turn: single chunk
  if (text.length <= config.maxSize) {
    chunks.push({
      id: generateChunkId(conversationId, turn.turnIndex, 0),
      text,
      turnIndex: turn.turnIndex,
      chunkIndex: 0,
      role: turn.role,
      speakerLabel: turn.speakerLabel,
      startTimeMs: turn.startTimeMs,
      endTimeMs: turn.endTimeMs,
      participantId: turn.participantId,
      charStart: turn.charStart,
      charEnd: turn.charEnd
    });
    return chunks;
  }
  
  // Long turn: split into sentence-based chunks
  const sentences = splitSentences(text);
  let currentChunk = "";
  let chunkIndex = 0;
  let charOffset = turn.charStart || 0;
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    
    // Would adding this sentence exceed max size?
    if (currentChunk.length + sentence.length + 1 > config.maxSize && currentChunk.length >= config.minSize) {
      // Save current chunk
      chunks.push({
        id: generateChunkId(conversationId, turn.turnIndex, chunkIndex),
        text: currentChunk.trim(),
        turnIndex: turn.turnIndex,
        chunkIndex,
        role: turn.role,
        speakerLabel: turn.speakerLabel,
        startTimeMs: turn.startTimeMs,
        endTimeMs: turn.endTimeMs,
        participantId: turn.participantId,
        charStart: charOffset,
        charEnd: charOffset + currentChunk.length
      });
      
      charOffset += currentChunk.length;
      chunkIndex++;
      currentChunk = "";
    }
    
    currentChunk += (currentChunk.length > 0 ? " " : "") + sentence;
  }
  
  // Save final chunk if not empty
  if (currentChunk.trim().length > 0) {
    chunks.push({
      id: generateChunkId(conversationId, turn.turnIndex, chunkIndex),
      text: currentChunk.trim(),
      turnIndex: turn.turnIndex,
      chunkIndex,
      role: turn.role,
      speakerLabel: turn.speakerLabel,
      startTimeMs: turn.startTimeMs,
      endTimeMs: turn.endTimeMs,
      participantId: turn.participantId,
      charStart: charOffset,
      charEnd: charOffset + currentChunk.length
    });
  }
  
  return chunks;
}

// =============================================================================
// MAIN API
// =============================================================================

/**
 * Generate transcript source chunks from a normalized conversation
 * 
 * CRITICAL: This MUST be called for every conversation to enable:
 * - Grounding edges in the claim graph
 * - Evidence attribution for issues
 * - Spectral analysis with non-trivial results
 */
export function generateTranscriptSources(
  conversation: NormalizedConversation,
  conversationId: string,
  options?: { chunkConfig?: Partial<typeof CHUNK_CONFIG> }
): TranscriptChunk[] {
  const config = { ...CHUNK_CONFIG, ...options?.chunkConfig };
  const chunks: TranscriptChunk[] = [];
  
  for (const turn of conversation.turns) {
    const turnChunks = chunkTurn(turn, conversationId, config);
    chunks.push(...turnChunks);
  }
  
  console.log(`📝 Generated ${chunks.length} transcript source chunks from ${conversation.turns.length} turns`);
  
  return chunks;
}

/**
 * Generate sources from raw transcript text (when no normalized conversation available)
 * 
 * This is a fallback for backwards compatibility when transcript is provided as raw text.
 */
export function generateSourcesFromRawTranscript(
  transcript: string,
  conversationId: string = "raw"
): Source[] {
  const sources: Source[] = [];
  
  // Split by speaker patterns or paragraphs
  const speakerPattern = /^(Agent|Customer|Rep|Caller|Speaker\s*\d*)\s*[:：]/gmi;
  const lines = transcript.split('\n').filter(l => l.trim().length > 0);
  
  let currentSpeaker = "Unknown";
  let currentText = "";
  let turnIndex = 0;
  
  for (const line of lines) {
    const match = line.match(/^(Agent|Customer|Rep|Caller|Speaker\s*\d*)\s*[:：]\s*(.*)/i);
    
    if (match) {
      // Save previous turn
      if (currentText.trim().length > 0) {
        sources.push({
          id: generateChunkId(conversationId, turnIndex, 0),
          text: `${currentSpeaker}: ${currentText.trim()}`
        });
        turnIndex++;
      }
      
      currentSpeaker = match[1];
      currentText = match[2];
    } else {
      // Continue current turn
      currentText += " " + line;
    }
  }
  
  // Save final turn
  if (currentText.trim().length > 0) {
    sources.push({
      id: generateChunkId(conversationId, turnIndex, 0),
      text: `${currentSpeaker}: ${currentText.trim()}`
    });
  }
  
  // If no speaker patterns found, chunk by sentences
  if (sources.length === 0) {
    const sentences = splitSentences(transcript);
    let chunkIndex = 0;
    let currentChunk = "";
    
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > CHUNK_CONFIG.targetSize && currentChunk.length > CHUNK_CONFIG.minSize) {
        sources.push({
          id: generateChunkId(conversationId, 0, chunkIndex),
          text: currentChunk.trim()
        });
        chunkIndex++;
        currentChunk = "";
      }
      currentChunk += (currentChunk.length > 0 ? " " : "") + sentence;
    }
    
    if (currentChunk.trim().length > 0) {
      sources.push({
        id: generateChunkId(conversationId, 0, chunkIndex),
        text: currentChunk.trim()
      });
    }
  }
  
  console.log(`📝 Generated ${sources.length} sources from raw transcript`);
  
  return sources;
}

// =============================================================================
// RETRIEVAL
// =============================================================================

/**
 * Simple embedding using character n-grams (fast, no external dependencies)
 * For production, use a real embedding model.
 */
function simpleEmbed(text: string, dim = 128): Float32Array {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const words = normalized.split(/\s+/).filter(w => w.length >= 3);
  
  const vec = new Float32Array(dim);
  for (const word of words) {
    // Hash word to position
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const pos = Math.abs(hash) % dim;
    vec[pos] += 1;
  }
  
  // Normalize
  let sum = 0;
  for (let i = 0; i < dim; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  
  return vec;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Retrieve top-k evidence chunks for a claim
 * 
 * Uses simple embedding + cosine similarity for fast retrieval.
 * In production, use a proper vector store (Pinecone, Weaviate, etc.)
 */
export function retrieveEvidence(
  claim: Claim,
  sources: Source[],
  k: number = 8
): EvidenceHit[] {
  if (sources.length === 0) return [];
  
  const claimEmbed = simpleEmbed(claim.text);
  const scored: Array<{ source: Source; score: number }> = [];
  
  for (const source of sources) {
    const sourceEmbed = simpleEmbed(source.text);
    const score = cosineSimilarity(claimEmbed, sourceEmbed);
    scored.push({ source, score });
  }
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  // Return top-k
  return scored.slice(0, k).map(({ source, score }) => ({
    sourceId: source.id,
    text: source.text,
    similarity: score,
    turnIndex: (source as TranscriptChunk).turnIndex,
    speaker: (source as TranscriptChunk).speakerLabel
  }));
}

/**
 * Retrieve evidence for all claims in batch
 */
export function retrieveEvidenceForClaims(
  claims: Claim[],
  sources: Source[],
  k: number = 8
): Map<string, EvidenceHit[]> {
  const result = new Map<string, EvidenceHit[]>();
  
  for (const claim of claims) {
    result.set(claim.id, retrieveEvidence(claim, sources, k));
  }
  
  return result;
}


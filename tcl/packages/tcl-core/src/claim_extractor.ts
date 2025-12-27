import { Claim } from "./types";

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function extractClaims(answer: string): Claim[] {
  const sentences = splitSentences(answer);
  return sentences.map((text, idx) => ({
    id: `c${idx + 1}`,
    text,
    confidence: 0.75,
    evidence: []
  }));
}

import { Claim } from "./types.js";

type Speaker = "Agent" | "Customer" | "Other";

type Turn = {
  speaker: Speaker;
  turnIndex: number;
  text: string;
};

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitTurns(text: string): Turn[] {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const turns: Turn[] = [];
  let t = 0;

  for (const ln of lines) {
    let speaker: Speaker = "Other";
    let body = ln;

    if (/^agent:/i.test(ln)) {
      speaker = "Agent";
      body = ln.replace(/^agent:\s*/i, "");
    } else if (/^customer:/i.test(ln)) {
      speaker = "Customer";
      body = ln.replace(/^customer:\s*/i, "");
    } else if (/^rep:/i.test(ln) || /^caller:/i.test(ln)) {
      speaker = "Agent"; // Treat rep/caller as agent
      body = ln.replace(/^(rep|caller):\s*/i, "");
    }

    if (body.length > 0) {
      turns.push({ speaker, turnIndex: t++, text: body });
    }
  }

  return turns;
}

function isTranscript(text: string): boolean {
  return /^(Agent|Customer|Rep|Caller):/im.test(text);
}

export function extractClaims(text: string): Claim[] {
  // Check if this is a transcript
  if (isTranscript(text)) {
    const turns = splitTurns(text);
    const claims: Claim[] = [];
    let claimIdx = 1;

    for (const turn of turns) {
      // Split turn text into sentences
      const sentences = splitSentences(turn.text);
      
      for (const sentence of sentences) {
        // Skip very short sentences (greetings, filler)
        if (sentence.length < 10) continue;
        
        // Skip common filler phrases
        const fillerPatterns = /^(thanks|thank you|okay|ok|yes|no|sure|alright|uh|um|hmm)/i;
        if (fillerPatterns.test(sentence.trim()) && sentence.length < 30) continue;

        claims.push({
          id: `c${claimIdx++}`,
          text: sentence,
          confidence: 0.75,
          evidence: [],
          meta: {
            speaker: turn.speaker,
            turnIndex: turn.turnIndex
          }
        });
      }
    }

    return claims;
  }

  // Regular text extraction (non-transcript)
  const sentences = splitSentences(text);
  return sentences.map((text, idx) => ({
    id: `c${idx + 1}`,
    text,
    confidence: 0.75,
    evidence: []
  }));
}

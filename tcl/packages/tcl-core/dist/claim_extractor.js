function splitSentences(text) {
    return text
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
function splitTurns(text) {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const turns = [];
    let t = 0;
    for (const ln of lines) {
        let speaker = "Other";
        let body = ln;
        if (/^agent:/i.test(ln)) {
            speaker = "Agent";
            body = ln.replace(/^agent:\s*/i, "");
        }
        else if (/^customer:/i.test(ln)) {
            speaker = "Customer";
            body = ln.replace(/^customer:\s*/i, "");
        }
        else if (/^rep:/i.test(ln) || /^caller:/i.test(ln)) {
            speaker = "Agent"; // Treat rep/caller as agent
            body = ln.replace(/^(rep|caller):\s*/i, "");
        }
        if (body.length > 0) {
            turns.push({ speaker, turnIndex: t++, text: body });
        }
    }
    return turns;
}
function isTranscript(text) {
    return /^(Agent|Customer|Rep|Caller):/im.test(text);
}
export function extractClaims(text) {
    // Check if this is a transcript
    const isTrans = isTranscript(text);
    console.log(`📝 Extracting claims: isTranscript=${isTrans}, text length=${text.length}`);
    if (isTrans) {
        const turns = splitTurns(text);
        console.log(`  Found ${turns.length} turns`);
        const claims = [];
        let claimIdx = 1;
        for (const turn of turns) {
            // Split turn text into sentences
            const sentences = splitSentences(turn.text);
            for (const sentence of sentences) {
                // Skip very short sentences (greetings, filler)
                if (sentence.length < 10)
                    continue;
                // Skip common filler phrases
                const fillerPatterns = /^(thanks|thank you|okay|ok|yes|no|sure|alright|uh|um|hmm)/i;
                if (fillerPatterns.test(sentence.trim()) && sentence.length < 30)
                    continue;
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
        console.log(`  Extracted ${claims.length} claims from transcript`);
        if (claims.length > 0) {
            console.log(`  First claim: "${claims[0].text.substring(0, 60)}..." (speaker: ${claims[0].meta?.speaker})`);
            console.log(`  Last claim: "${claims[claims.length - 1].text.substring(0, 60)}..." (speaker: ${claims[claims.length - 1].meta?.speaker})`);
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

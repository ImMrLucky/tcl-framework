/**
 * Canonical Batch Ingestion Contract
 *
 * Defines the standard internal format for transcripts ingested via batch upload.
 * All batch format parsers (zip, jsonl, csv) must normalize their output to this schema.
 */
/**
 * Validation helper: ensures a CanonicalTranscript meets requirements
 */
export function validateCanonicalTranscript(transcript) {
    if (!transcript || typeof transcript !== 'object') {
        return false;
    }
    if (!Array.isArray(transcript.turns) || transcript.turns.length === 0) {
        return false;
    }
    if (!transcript.source || typeof transcript.source !== 'object') {
        return false;
    }
    if (!transcript.source.provider || !transcript.source.file_name) {
        return false;
    }
    // Validate turns
    for (let i = 0; i < transcript.turns.length; i++) {
        const turn = transcript.turns[i];
        if (typeof turn.t !== 'number' || turn.t !== i) {
            return false; // Turn index must match array position
        }
        if (typeof turn.text !== 'string' || turn.text.trim().length === 0) {
            return false; // Text is required and non-empty
        }
        if (turn.speaker_raw !== null && typeof turn.speaker_raw !== 'string') {
            return false;
        }
    }
    return true;
}
/**
 * Normalize a transcript to canonical format
 */
export function normalizeToCanonical(raw, source, metadata) {
    // If already in canonical format, validate and return
    if (validateCanonicalTranscript(raw)) {
        return {
            ...raw,
            source,
            metadata: { ...raw.metadata, ...metadata },
        };
    }
    // Otherwise, attempt to normalize from common formats
    const turns = [];
    if (Array.isArray(raw.turns)) {
        // Already has turns array
        raw.turns.forEach((turn, index) => {
            turns.push({
                t: index,
                speaker_raw: turn.speaker_raw || turn.speaker || null,
                text: String(turn.text || turn.content || ''),
                timestamp: typeof turn.timestamp === 'number' ? turn.timestamp : undefined,
            });
        });
    }
    else if (typeof raw.text === 'string') {
        // Single text blob - split heuristically
        const lines = raw.text.split('\n').filter((line) => line.trim().length > 0);
        lines.forEach((line, index) => {
            // Try to extract speaker prefix (e.g., "Agent: Hello" or "SPEAKER_0: Hello")
            const speakerMatch = line.match(/^([A-Za-z_0-9]+):\s*(.+)$/);
            if (speakerMatch) {
                turns.push({
                    t: index,
                    speaker_raw: speakerMatch[1],
                    text: speakerMatch[2].trim(),
                });
            }
            else {
                turns.push({
                    t: index,
                    speaker_raw: null,
                    text: line.trim(),
                });
            }
        });
    }
    return {
        conversation_id: raw.conversation_id,
        turns,
        source,
        metadata: { ...raw.metadata, ...metadata },
    };
}

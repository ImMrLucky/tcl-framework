/**
 * Evidence Chunking
 * Splits extracted text into chunks for embedding and retrieval
 */
/**
 * Chunk text intelligently by headings and paragraphs
 */
export function chunkText(text, evidenceItemId, options = {}) {
    const { maxChunkSize = 1000, // Default: 1000 characters per chunk
    chunkOverlap = 200, // Default: 200 characters overlap
    preserveHeadings = true, } = options;
    const chunks = [];
    let chunkIndex = 0;
    // Split by double newlines (paragraphs) first
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    let currentChunk = '';
    let currentHeading;
    let currentStartChar = 0;
    let charOffset = 0;
    for (const paragraph of paragraphs) {
        const trimmed = paragraph.trim();
        // Detect headings (lines that are short and end without punctuation)
        const isHeading = preserveHeadings &&
            trimmed.length < 100 &&
            !trimmed.match(/[.!?]$/) &&
            (trimmed.match(/^#{1,6}\s/) || // Markdown heading
                trimmed.split('\n').length === 1); // Single line
        if (isHeading) {
            currentHeading = trimmed.replace(/^#+\s*/, '');
        }
        // If adding this paragraph would exceed maxChunkSize, finalize current chunk
        if (currentChunk.length > 0 &&
            currentChunk.length + trimmed.length + 2 > maxChunkSize) {
            // Finalize current chunk
            chunks.push({
                chunkId: `${evidenceItemId}-chunk-${String(chunkIndex).padStart(3, '0')}`,
                content: currentChunk.trim(),
                metadata: {
                    heading: currentHeading,
                    startChar: currentStartChar,
                    endChar: charOffset,
                },
            });
            // Start new chunk with overlap
            const overlapText = currentChunk.slice(-chunkOverlap);
            currentChunk = overlapText + '\n\n' + trimmed;
            currentStartChar = charOffset - chunkOverlap;
            chunkIndex++;
        }
        else {
            // Add paragraph to current chunk
            if (currentChunk.length > 0) {
                currentChunk += '\n\n';
            }
            currentChunk += trimmed;
        }
        charOffset += paragraph.length + 2; // +2 for the double newline
    }
    // Add final chunk
    if (currentChunk.trim().length > 0) {
        chunks.push({
            chunkId: `${evidenceItemId}-chunk-${String(chunkIndex).padStart(3, '0')}`,
            content: currentChunk.trim(),
            metadata: {
                heading: currentHeading,
                startChar: currentStartChar,
                endChar: charOffset,
            },
        });
    }
    return chunks;
}

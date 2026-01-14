/**
 * Evidence Chunking
 * Splits extracted text into chunks for embedding and retrieval
 */
export interface TextChunk {
    chunkId: string;
    content: string;
    metadata: {
        heading?: string;
        page?: number;
        startChar?: number;
        endChar?: number;
    };
}
/**
 * Chunk text intelligently by headings and paragraphs
 */
export declare function chunkText(text: string, evidenceItemId: string, options?: {
    maxChunkSize?: number;
    chunkOverlap?: number;
    preserveHeadings?: boolean;
}): TextChunk[];

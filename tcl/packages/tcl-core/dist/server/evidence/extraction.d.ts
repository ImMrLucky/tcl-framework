/**
 * Evidence Text Extraction
 * Extracts text from various file formats for evidence indexing
 */
export interface ExtractedText {
    text: string;
    metadata?: {
        pageCount?: number;
        headings?: string[];
        language?: string;
    };
}
/**
 * Extract text from a file buffer based on MIME type
 */
export declare function extractTextFromBuffer(buffer: Buffer, mimeType: string, filename: string): Promise<ExtractedText>;
/**
 * Extract text from a file path
 */
export declare function extractTextFromFile(filePath: string, mimeType: string): Promise<ExtractedText>;

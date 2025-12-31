/**
 * Evidence Document Parser
 * Parses various document formats (TXT, JSON, CSV, XLSX) for evidence extraction
 * Note: XLSX support requires optional xlsx dependency (loaded dynamically)
 */
export interface ParsedEvidence {
    text: string;
    structured?: Record<string, any>;
    metadata: {
        filename: string;
        content_type: string;
        file_type: string;
    };
}
/**
 * Parse evidence document from content
 */
export declare function parseEvidenceDocument(content: string | Buffer, filename: string, contentType?: string): Promise<ParsedEvidence | null>;

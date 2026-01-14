/**
 * Evidence Text Extraction
 * Extracts text from various file formats for evidence indexing
 */
import fs from 'fs';
/**
 * Extract text from a file buffer based on MIME type
 */
export async function extractTextFromBuffer(buffer, mimeType, filename) {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    // Handle text-based formats
    if (mimeType.startsWith('text/') || ext === 'txt' || ext === 'md') {
        return {
            text: buffer.toString('utf-8'),
        };
    }
    // Handle JSON
    if (mimeType === 'application/json' || ext === 'json') {
        try {
            const json = JSON.parse(buffer.toString('utf-8'));
            // Try to extract text from common JSON structures
            if (typeof json === 'string') {
                return { text: json };
            }
            if (typeof json === 'object') {
                // Extract text from object values
                const textParts = [];
                const extractText = (obj) => {
                    if (typeof obj === 'string') {
                        textParts.push(obj);
                    }
                    else if (Array.isArray(obj)) {
                        obj.forEach(extractText);
                    }
                    else if (obj && typeof obj === 'object') {
                        Object.values(obj).forEach(extractText);
                    }
                };
                extractText(json);
                return { text: textParts.join('\n\n') };
            }
            return { text: JSON.stringify(json, null, 2) };
        }
        catch (e) {
            return { text: buffer.toString('utf-8') };
        }
    }
    // Handle CSV
    if (mimeType === 'text/csv' || ext === 'csv') {
        const text = buffer.toString('utf-8');
        // Convert CSV to readable text format
        const lines = text.split('\n');
        const textLines = lines.map(line => {
            const cells = line.split(',').map(cell => cell.trim().replace(/^"|"$/g, ''));
            return cells.join(' | ');
        });
        return { text: textLines.join('\n') };
    }
    // Handle HTML
    if (mimeType === 'text/html' || ext === 'html' || ext === 'htm') {
        const html = buffer.toString('utf-8');
        // Simple HTML to text extraction (strip tags)
        const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        // Extract headings
        const headingMatches = html.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi);
        const headings = headingMatches
            ? headingMatches.map(h => h.replace(/<[^>]+>/g, '').trim())
            : [];
        return {
            text,
            metadata: { headings },
        };
    }
    // Handle PDF (optional: requires pdf-parse package)
    if (mimeType === 'application/pdf' || ext === 'pdf') {
        try {
            // Try to use pdf-parse if available (dynamic import with error handling)
            let pdfParse = null;
            try {
                // Use require for optional dependency to avoid TypeScript errors
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                pdfParse = require('pdf-parse');
            }
            catch (importError) {
                // pdf-parse not installed - will use fallback
            }
            if (pdfParse) {
                const data = await pdfParse(buffer);
                return {
                    text: data.text,
                    metadata: {
                        pageCount: data.numpages,
                    },
                };
            }
            else {
                // Fallback: try to extract text as plain text (may not work for binary PDFs)
                // For binary PDFs, user needs to install: npm install pdf-parse
                console.warn('pdf-parse not available. Attempting basic text extraction (may fail for binary PDFs).');
                const text = buffer.toString('utf-8');
                // Check if it's a binary PDF (starts with PDF header)
                if (buffer.slice(0, 4).toString() === '%PDF') {
                    throw new Error('Binary PDF detected. Install pdf-parse for PDF support: npm install pdf-parse');
                }
                return { text };
            }
        }
        catch (error) {
            throw new Error(`Failed to extract text from PDF: ${error.message}`);
        }
    }
    // Handle DOCX (optional: requires mammoth package)
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === 'docx') {
        try {
            // Try to use mammoth if available (dynamic import with error handling)
            let mammoth = null;
            try {
                // Use require for optional dependency to avoid TypeScript errors
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                mammoth = require('mammoth');
            }
            catch (importError) {
                // mammoth not installed - will throw error below
            }
            if (mammoth && mammoth.extractRawText) {
                const result = await mammoth.extractRawText({ buffer });
                return {
                    text: result.value,
                    metadata: {
                        // Extract headings from DOCX structure if available
                        headings: result.messages
                            .filter((m) => m.type === 'warning')
                            .map((m) => m.message)
                            .filter((msg) => msg.includes('heading')),
                    },
                };
            }
            else {
                // DOCX is a binary format, cannot extract without mammoth
                throw new Error('DOCX parsing requires mammoth package. Install with: npm install mammoth (optional)');
            }
        }
        catch (error) {
            throw new Error(`Failed to extract text from DOCX: ${error.message}`);
        }
    }
    // Default: try to decode as UTF-8 text
    try {
        return { text: buffer.toString('utf-8') };
    }
    catch (e) {
        throw new Error(`Unsupported file type: ${mimeType} (${ext})`);
    }
}
/**
 * Extract text from a file path
 */
export async function extractTextFromFile(filePath, mimeType) {
    const buffer = await fs.promises.readFile(filePath);
    const filename = filePath.split('/').pop() || filePath;
    return extractTextFromBuffer(buffer, mimeType, filename);
}

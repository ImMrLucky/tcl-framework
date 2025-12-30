/**
 * Evidence Document Parser
 * Parses various document formats (TXT, JSON, CSV, XLSX) for evidence extraction
 */

import * as XLSX from 'xlsx';

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
export function parseEvidenceDocument(
  content: string | Buffer,
  filename: string,
  contentType?: string
): ParsedEvidence | null {
  try {
    const fileType = detectFileType(filename, contentType);
    const contentStr = Buffer.isBuffer(content) ? content.toString('utf-8') : content;

    switch (fileType) {
      case 'txt':
        return parseTXT(contentStr, filename);
      
      case 'json':
        return parseJSON(contentStr, filename);
      
      case 'csv':
        return parseCSV(contentStr, filename);
      
      case 'xlsx':
        return parseXLSX(content, filename);
      
      default:
        // Try to parse as text
        return parseTXT(contentStr, filename);
    }
  } catch (error: any) {
    console.error(`Error parsing evidence document ${filename}:`, error);
    return null;
  }
}

function detectFileType(filename: string, contentType?: string): 'txt' | 'json' | 'csv' | 'xlsx' | 'unknown' {
  const ext = filename.split('.').pop()?.toLowerCase();
  
  if (ext === 'txt' || ext === 'text') return 'txt';
  if (ext === 'json') return 'json';
  if (ext === 'csv') return 'csv';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  
  if (contentType?.includes('text/plain')) return 'txt';
  if (contentType?.includes('application/json')) return 'json';
  if (contentType?.includes('text/csv')) return 'csv';
  if (contentType?.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) return 'xlsx';
  if (contentType?.includes('application/vnd.ms-excel')) return 'xlsx';
  
  return 'unknown';
}

function parseTXT(content: string, filename: string): ParsedEvidence {
  return {
    text: content,
    metadata: {
      filename,
      content_type: 'text/plain',
      file_type: 'txt',
    },
  };
}

function parseJSON(content: string, filename: string): ParsedEvidence {
  const json = JSON.parse(content);
  
  // Extract text from common JSON structures
  let text = '';
  if (typeof json === 'string') {
    text = json;
  } else if (Array.isArray(json)) {
    text = json.map(item => 
      typeof item === 'string' ? item : JSON.stringify(item)
    ).join('\n');
  } else if (typeof json === 'object') {
    // Try common fields
    if (json.text) {
      text = typeof json.text === 'string' ? json.text : JSON.stringify(json.text);
    } else if (json.content) {
      text = typeof json.content === 'string' ? json.content : JSON.stringify(json.content);
    } else if (json.body) {
      text = typeof json.body === 'string' ? json.body : JSON.stringify(json.body);
    } else {
      // Flatten object to text
      text = JSON.stringify(json, null, 2);
    }
  }
  
  return {
    text,
    structured: json,
    metadata: {
      filename,
      content_type: 'application/json',
      file_type: 'json',
    },
  };
}

function parseCSV(content: string, filename: string): ParsedEvidence {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) {
    return {
      text: '',
      metadata: {
        filename,
        content_type: 'text/csv',
        file_type: 'csv',
      },
    };
  }
  
  // Parse CSV (simple parser - handles quoted fields)
  const rows: string[][] = [];
  for (const line of lines) {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    rows.push(row);
  }
  
  // Convert to text format
  const headers = rows[0] || [];
  const text = rows.slice(1)
    .map(row => {
      return headers.map((header, idx) => {
        const value = row[idx] || '';
        return `${header}: ${value}`;
      }).join(' | ');
    })
    .join('\n');
  
  return {
    text: text || content,
    structured: {
      headers,
      rows: rows.slice(1),
    },
    metadata: {
      filename,
      content_type: 'text/csv',
      file_type: 'csv',
    },
  };
}

function parseXLSX(content: string | Buffer, filename: string): ParsedEvidence {
  try {
    const workbook = XLSX.read(content, { type: Buffer.isBuffer(content) ? 'buffer' : 'string' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON first
    const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Convert to text
    const rows = json as any[][];
    if (rows.length === 0) {
      return {
        text: '',
        metadata: {
          filename,
          content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          file_type: 'xlsx',
        },
      };
    }
    
    const headers = rows[0] || [];
    const text = rows.slice(1)
      .map(row => {
        return headers.map((header: any, idx: number) => {
          const value = row[idx] || '';
          return `${header}: ${value}`;
        }).join(' | ');
      })
      .join('\n');
    
    return {
      text,
      structured: {
        headers,
        rows: rows.slice(1),
        sheetName,
      },
      metadata: {
        filename,
        content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        file_type: 'xlsx',
      },
    };
  } catch (error: any) {
    console.error(`Error parsing XLSX file ${filename}:`, error);
    // Fallback to text parsing
    const contentStr = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
    return parseTXT(contentStr, filename);
  }
}


/**
 * ZIP Archive Parser for Batch Ingestion
 * 
 * Parses ZIP files containing transcripts, audio, and metadata.
 * Automatically pairs audio + transcript files by basename.
 */

import * as yauzl from 'yauzl';
import { promisify } from 'util';
import type { CanonicalTranscript, TranscriptSource } from '../canonical-transcript.js';
import { normalizeToCanonical } from '../canonical-transcript.js';
import { getBatchIngestionConfig } from '../batch-config.js';
import { normalizeFile } from '../normalizers/index.js';

const openZip = promisify(yauzl.fromBuffer);

export interface ZipParseResult {
  transcripts: CanonicalTranscript[];
  attachments: Array<{
    name: string;
    path: string;
    type: 'audio' | 'metadata';
    data: Buffer;
  }>;
  errors: Array<{
    file: string;
    error: string;
  }>;
}

/**
 * Parse a ZIP file and extract transcripts, audio, and metadata
 */
export async function parseZipBatch(
  zipBuffer: Buffer,
  zipFileName: string
): Promise<ZipParseResult> {
  const config = getBatchIngestionConfig();
  const transcripts: CanonicalTranscript[] = [];
  const attachments: ZipParseResult['attachments'] = [];
  const errors: ZipParseResult['errors'] = [];
  
  // Map of basename -> files (for pairing audio + transcript)
  const fileMap = new Map<string, {
    transcript?: { name: string; ext: string; entry: yauzl.Entry };
    audio?: { name: string; ext: string; entry: yauzl.Entry };
    metadata?: { name: string; ext: string; entry: yauzl.Entry };
  }>();
  
  try {
    const zipfile = await openZip(zipBuffer);
    
    // First pass: collect all files and group by basename
    await new Promise<void>((resolve, reject) => {
      zipfile.on('entry', (entry: yauzl.Entry) => {
        // Skip directories
        if (entry.fileName.endsWith('/')) {
          zipfile.readEntry();
          return;
        }
        
        const ext = getExtension(entry.fileName);
        const basename = getBasename(entry.fileName);
        
        if (!fileMap.has(basename)) {
          fileMap.set(basename, {});
        }
        
        const group = fileMap.get(basename)!;
        
        if (config.zip_rules.transcript_extensions.includes(ext)) {
          group.transcript = { name: entry.fileName, ext, entry };
        } else if (config.zip_rules.audio_extensions.includes(ext)) {
          group.audio = { name: entry.fileName, ext, entry };
        } else if (config.zip_rules.metadata_extensions.includes(ext)) {
          group.metadata = { name: entry.fileName, ext, entry };
        }
        
        zipfile.readEntry();
      });
      
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
    
    // Second pass: process each file group
    for (const [basename, group] of fileMap.entries()) {
      try {
        // Extract and parse transcript
        if (group.transcript) {
          const transcriptData = await extractZipEntry(zipfile, group.transcript.entry);
          const transcript = await parseTranscriptFile(
            transcriptData,
            group.transcript.name,
            group.transcript.ext,
            zipFileName
          );
          
          if (transcript) {
            // Attach audio if available
            if (group.audio) {
              const audioData = await extractZipEntry(zipfile, group.audio.entry);
              attachments.push({
                name: group.audio.name,
                path: group.audio.name,
                type: 'audio',
                data: audioData,
              });
              transcript.metadata = {
                ...transcript.metadata,
                audio_file: group.audio.name,
              };
            }
            
            // Attach metadata if available
            if (group.metadata) {
              const metadataData = await extractZipEntry(zipfile, group.metadata.entry);
              attachments.push({
                name: group.metadata.name,
                path: group.metadata.name,
                type: 'metadata',
                data: metadataData,
              });
              transcript.metadata = {
                ...transcript.metadata,
                metadata_file: group.metadata.name,
              };
            }
            
            transcripts.push(transcript);
          }
        } else if (group.audio) {
          // Audio-only file
          if (config.zip_rules.require_transcript_for_audio) {
            errors.push({
              file: group.audio.name,
              error: 'Audio file requires matching transcript file',
            });
          } else {
            // Store as attachment, will be processed as audio-only ingestion
            const audioData = await extractZipEntry(zipfile, group.audio.entry);
            attachments.push({
              name: group.audio.name,
              path: group.audio.name,
              type: 'audio',
              data: audioData,
            });
            // Note: Audio-only transcripts will need special handling in ingestion pipeline
          }
        } else {
          // Metadata-only or unknown file
          if (group.metadata) {
            // Store metadata for later association
            const metadataData = await extractZipEntry(zipfile, group.metadata.entry);
            attachments.push({
              name: group.metadata.name,
              path: group.metadata.name,
              type: 'metadata',
              data: metadataData,
            });
          }
        }
      } catch (error: any) {
        errors.push({
          file: basename,
          error: error.message || 'Unknown error',
        });
      }
    }
  } catch (error: any) {
    errors.push({
      file: zipFileName,
      error: `Failed to parse ZIP: ${error.message}`,
    });
  }
  
  return { transcripts, attachments, errors };
}

/**
 * Extract a single entry from ZIP
 */
async function extractZipEntry(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err: Error | null, readStream: NodeJS.ReadableStream | null) => {
      if (err) {
        reject(err);
        return;
      }
      if (!readStream) {
        reject(new Error('Failed to open read stream'));
        return;
      }
      
      const chunks: Buffer[] = [];
      readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      readStream.on('end', () => resolve(Buffer.concat(chunks)));
      readStream.on('error', reject);
    });
  });
}

/**
 * Parse a transcript file based on extension
 */
async function parseTranscriptFile(
  data: Buffer,
  fileName: string,
  ext: string,
  zipFileName: string
): Promise<CanonicalTranscript | null> {
  const source: TranscriptSource = {
    provider: 'zip',
    file_name: zipFileName,
    path_in_archive: fileName,
  };
  
  try {
    // Use normalizeFile to parse the transcript
    const result = await normalizeFile(data, fileName);
    
    if (!result.success || !result.normalized) {
      throw new Error(result.warnings?.[0] || 'Failed to normalize file');
    }
    
    // Convert NormalizedConversation to CanonicalTranscript
    const canonical: CanonicalTranscript = {
      conversation_id: result.normalized.raw?.originalFilename || fileName.replace(/\.[^/.]+$/, ''),
      turns: result.normalized.turns.map((turn) => ({
        t: turn.turnIndex,
        speaker_raw: turn.speakerLabel || turn.meta?.rawSpeaker || undefined,
        text: turn.text,
        start_ms: turn.startTimeMs,
        end_ms: turn.endTimeMs,
      })),
      source,
      metadata: {
        ...result.normalized.conversation,
        ...result.normalized.raw?.inferredValues,
      },
    };
    
    return canonical;
  } catch (error: any) {
    throw new Error(`Failed to parse ${fileName}: ${error.message}`);
  }
}

/**
 * Get file extension (without leading dot)
 */
function getExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Get basename (filename without extension)
 */
function getBasename(fileName: string): string {
  const name = fileName.split('/').pop() || fileName;
  const ext = getExtension(name);
  return ext ? name.slice(0, -(ext.length + 1)) : name;
}


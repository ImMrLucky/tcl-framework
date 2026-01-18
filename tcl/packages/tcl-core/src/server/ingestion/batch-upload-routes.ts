/**
 * Batch Upload API Routes (SPEC 1)
 * 
 * Handles batch file uploads with format parsing (zip, jsonl, csv)
 */

import express from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';
import { requireEntitlement } from '../entitlements/middleware.js';
import { getBatchIngestionConfig, isAcceptedExtension, isWithinSizeLimit } from './batch-config.js';
import { parseZipBatch } from './parsers/zip-parser.js';
import { parseJsonlBatch } from './parsers/jsonl-parser.js';
import { parseCsvBatch } from './parsers/csv-batch-parser.js';
import { createIngestionJob } from '../ingest/jobs.js';
import { enqueueJob } from '../ingest/worker.js';

// Configure multer for batch uploads
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB default (configurable)
  },
});

/**
 * Setup batch upload routes
 */
export function setupBatchUploadRoutes(app: express.Application) {
  // ============================================================================
  // POST /api/ingest/batch - Batch file upload with parsing
  // ============================================================================
  app.post(
    '/api/ingest/batch',
    requireEntitlement('batchIngestion'),
    batchUpload.array('files', 100), // Allow up to 100 files
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Database not configured' });
        }

        const files = req.files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
          return res.status(400).json({ error: 'No files provided' });
        }

        const config = getBatchIngestionConfig();
        const { template_id, mode, metadata } = req.body;
        
        // Validate files
        const validationErrors: string[] = [];
        for (const file of files) {
          const ext = getExtension(file.originalname);
          if (!isAcceptedExtension(ext, config)) {
            validationErrors.push(`File ${file.originalname}: Unsupported file type .${ext}`);
          }
          if (!isWithinSizeLimit(file.size, config)) {
            validationErrors.push(`File ${file.originalname}: Exceeds size limit of ${config.max_upload_size_mb}MB`);
          }
        }

        if (validationErrors.length > 0) {
          return res.status(400).json({
            error: 'File validation failed',
            details: validationErrors,
          });
        }

        // Create import record
        const { data: importRecord, error: importError } = await supabaseAdmin
          .from('ingest_imports')
          .insert({
            org_id: context.orgId,
            created_by_user_id: context.userId,
            type: 'BATCH_UPLOAD',
            status: 'PROCESSING',
            template_id: template_id || null,
            config_json: {
              mode: mode || 'AUDIO_PLUS_TRANSCRIPT',
              metadata: metadata ? JSON.parse(metadata) : {},
            },
            total_files: files.length,
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (importError) {
          return res.status(500).json({ error: `Failed to create import: ${importError.message}` });
        }

        // Parse files and create import items
        const allTranscripts: Array<{ transcript: any; sourceName: string; errors: any[] }> = [];
        const importItems: Array<{
          import_id: string;
          source_name: string;
          status: string;
          error?: string;
          warnings?: any;
        }> = [];

        for (const file of files) {
          try {
            const ext = getExtension(file.originalname);
            let parseResult: any;

            if (ext === 'zip') {
              parseResult = await parseZipBatch(file.buffer, file.originalname);
              // For zip, we get multiple transcripts
              parseResult.transcripts.forEach((t: any) => {
                allTranscripts.push({
                  transcript: t,
                  sourceName: file.originalname,
                  errors: [],
                });
              });
              // Create import items for zip contents
              parseResult.transcripts.forEach((t: any, idx: number) => {
                importItems.push({
                  import_id: importRecord.id,
                  source_name: t.source.path_in_archive || `${file.originalname}/${idx}`,
                  status: 'PARSED',
                  warnings: parseResult.errors.length > 0 ? parseResult.errors : null,
                });
              });
              // Add errors for failed zip entries
              parseResult.errors.forEach((err: any) => {
                importItems.push({
                  import_id: importRecord.id,
                  source_name: err.file,
                  status: 'FAILED',
                  error: err.error,
                });
              });
            } else if (ext === 'jsonl') {
              parseResult = parseJsonlBatch(file.buffer, file.originalname);
              parseResult.transcripts.forEach((t: any) => {
                allTranscripts.push({
                  transcript: t,
                  sourceName: file.originalname,
                  errors: [],
                });
              });
              // Create import item for jsonl file
              importItems.push({
                import_id: importRecord.id,
                source_name: file.originalname,
                status: parseResult.errors.length > 0 ? 'PARTIAL' : 'PARSED',
                warnings: parseResult.errors.length > 0 ? parseResult.errors : null,
              });
            } else if (ext === 'csv') {
              parseResult = parseCsvBatch(file.buffer, file.originalname);
              parseResult.transcripts.forEach((t: any) => {
                allTranscripts.push({
                  transcript: t,
                  sourceName: file.originalname,
                  errors: [],
                });
              });
              // Create import item for csv file
              importItems.push({
                import_id: importRecord.id,
                source_name: file.originalname,
                status: parseResult.errors.length > 0 ? 'PARTIAL' : 'PARSED',
                warnings: parseResult.errors.length > 0 ? parseResult.errors : null,
              });
            } else {
              // Single file - will be processed by normal ingestion pipeline
              importItems.push({
                import_id: importRecord.id,
                source_name: file.originalname,
                status: 'QUEUED_FOR_ANALYSIS',
              });
            }
          } catch (error: any) {
            importItems.push({
              import_id: importRecord.id,
              source_name: file.originalname,
              status: 'FAILED',
              error: error.message || 'Unknown parsing error',
            });
          }
        }

        // Insert import items
        if (importItems.length > 0) {
          const { error: itemsError } = await supabaseAdmin
            .from('ingest_import_items')
            .insert(importItems);

          if (itemsError) {
            console.error('Failed to insert import items:', itemsError);
          }
        }

        // Process parsed transcripts (create conversations and optionally evaluations)
        let parsedCount = 0;
        let failedCount = 0;

        for (const { transcript, sourceName } of allTranscripts) {
          try {
            // Create conversation from canonical transcript
            // TODO: Implement conversation creation from canonical transcript
            // For now, we'll need to integrate with existing ingestion pipeline
            
            parsedCount++;
          } catch (error: any) {
            failedCount++;
            console.error(`Failed to process transcript from ${sourceName}:`, error);
          }
        }

        // Update import status
        const finalStatus = failedCount === 0 ? 'DONE' : failedCount < allTranscripts.length ? 'PARTIAL' : 'FAILED';
        await supabaseAdmin
          .from('ingest_imports')
          .update({
            status: finalStatus,
            parsed_transcripts: parsedCount,
            failed_items: failedCount,
            completed_at: new Date().toISOString(),
          })
          .eq('id', importRecord.id);

        res.json({
          import_id: importRecord.id,
          status: finalStatus,
          counts: {
            total_files: files.length,
            parsed_transcripts: parsedCount,
            failed_items: failedCount,
          },
          items: importItems.slice(0, 50), // First 50 items
        });
      } catch (error: any) {
        console.error('Batch upload error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/ingest/batch/{import_id} - Get import details
  // ============================================================================
  app.get('/api/ingest/batch/:import_id', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { import_id } = req.params;

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Database not configured' });
      }

      const { data: importRecord, error: importError } = await supabaseAdmin
        .from('ingest_imports')
        .select('*')
        .eq('id', import_id)
        .eq('org_id', context.orgId)
        .single();

      if (importError || !importRecord) {
        return res.status(404).json({ error: 'Import not found' });
      }

      res.json({ import: importRecord });
    } catch (error: any) {
      console.error('Get import error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });

  // ============================================================================
  // GET /api/ingest/batch/{import_id}/items - Get import items
  // ============================================================================
  app.get('/api/ingest/batch/:import_id/items', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      const { import_id } = req.params;
      const cursor = req.query.cursor as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Database not configured' });
      }

      // Verify import belongs to org
      const { data: importRecord } = await supabaseAdmin
        .from('ingest_imports')
        .select('id')
        .eq('id', import_id)
        .eq('org_id', context.orgId)
        .single();

      if (!importRecord) {
        return res.status(404).json({ error: 'Import not found' });
      }

      let query = supabaseAdmin
        .from('ingest_import_items')
        .select('*', { count: 'exact' })
        .eq('import_id', import_id)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (cursor) {
        // Use cursor for pagination (simple offset-based for now)
        const offset = parseInt(cursor, 10) || 0;
        query = query.range(offset, offset + limit - 1);
      }

      const { data: items, error: itemsError, count } = await query;

      if (itemsError) {
        return res.status(500).json({ error: `Failed to fetch items: ${itemsError.message}` });
      }

      res.json({
        items: items || [],
        total: count || 0,
        cursor: cursor ? String(parseInt(cursor, 10) + limit) : String(limit),
        has_more: (count || 0) > (parseInt(cursor || '0', 10) + limit),
      });
    } catch (error: any) {
      console.error('Get import items error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });
}

/**
 * Get file extension (without leading dot)
 */
function getExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}


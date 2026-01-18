/**
 * Scheduled Ingestion Worker
 * 
 * Polls for scheduled ingestion jobs and executes them.
 * Runs every minute to check for schedules that need to run.
 */

import { supabaseAdmin } from '../supabase.js';

// In-memory scheduler state
let isSchedulerRunning = false;
let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Start the scheduler worker
 */
export function startSchedulerWorker(): void {
  if (isSchedulerRunning) {
    console.log('[Scheduler] Worker already running');
    return;
  }

  console.log('[Scheduler] Starting scheduler worker...');
  isSchedulerRunning = true;

  // Run immediately on start
  checkAndRunSchedules().catch(err => {
    console.error('[Scheduler] Error in initial schedule check:', err);
  });

  // Then run every minute
  schedulerInterval = setInterval(() => {
    checkAndRunSchedules().catch(err => {
      console.error('[Scheduler] Error in scheduled check:', err);
    });
  }, 60 * 1000); // 60 seconds

  console.log('[Scheduler] Worker started, checking every 60 seconds');
}

/**
 * Stop the scheduler worker
 */
export function stopSchedulerWorker(): void {
  if (!isSchedulerRunning) {
    return;
  }

  console.log('[Scheduler] Stopping scheduler worker...');
  isSchedulerRunning = false;

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  console.log('[Scheduler] Worker stopped');
}

/**
 * Check for schedules that need to run and execute them
 */
async function checkAndRunSchedules(): Promise<void> {
  if (!supabaseAdmin) {
    console.error('[Scheduler] Database not configured');
    return;
  }

  const now = new Date().toISOString();

  // Find schedules that are enabled and due to run
  const { data: schedules, error } = await supabaseAdmin
    .from('ingest_schedules')
    .select('*')
    .eq('enabled', true)
    .lte('next_run_at', now)
    .order('next_run_at', { ascending: true });

  if (error) {
    console.error('[Scheduler] Failed to fetch schedules:', error);
    return;
  }

  if (!schedules || schedules.length === 0) {
    return; // No schedules to run
  }

  console.log(`[Scheduler] Found ${schedules.length} schedule(s) to run`);

  // Execute each schedule
  for (const schedule of schedules) {
    try {
      await executeSchedule(schedule);
    } catch (error: any) {
      console.error(`[Scheduler] Error executing schedule ${schedule.id}:`, error);
    }
  }
}

/**
 * Execute a single schedule
 */
async function executeSchedule(schedule: any): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  console.log(`[Scheduler] Executing schedule: ${schedule.name} (${schedule.id})`);

  // Create schedule run record
  const { data: run, error: runError } = await supabaseAdmin
    .from('ingest_schedule_runs')
    .insert({
      schedule_id: schedule.id,
      status: 'RUNNING',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (runError || !run) {
    throw new Error(`Failed to create schedule run: ${runError?.message}`);
  }

  try {
    // Get source configuration
    const { data: source, error: sourceError } = await supabaseAdmin
      .from('ingest_sources')
      .select('*')
      .eq('id', schedule.source_id)
      .single();

    if (sourceError || !source) {
      throw new Error(`Source not found: ${sourceError?.message}`);
    }

    // List objects from source (implementation depends on source type)
    const newObjects = await listNewObjectsFromSource(source, schedule);

    // Process each new object
    const stats = {
      new_files: newObjects.length,
      parsed: 0,
      failed: 0,
      skipped: 0,
    };

    // Create import record
    const { data: importRecord, error: importError } = await supabaseAdmin
      .from('ingest_imports')
      .insert({
        org_id: schedule.org_id,
        created_by_user_id: schedule.created_by_user_id,
        type: 'BATCH_UPLOAD',
        status: 'PROCESSING',
        template_id: schedule.template_id || null,
        config_json: {
          mode: schedule.mode || 'AUDIO_PLUS_TRANSCRIPT',
          source_type: source.type,
          schedule_id: schedule.id,
        },
        total_files: newObjects.length,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (importError) {
      throw new Error(`Failed to create import: ${importError.message}`);
    }

    // Process objects (download, parse, create conversations)
    const importItems: any[] = [];
    const config = source.config_json.config || {};
    const secrets = source.config_json.secrets || {};
    
    for (const obj of newObjects) {
      try {
        // Get connector for downloading
        let connector: any = null;
        if (source.type === 'S3') {
          const { S3ConnectorProvider } = await import('../connectors/s3-connector.js');
          connector = new S3ConnectorProvider();
        } else if (source.type === 'DROPBOX') {
          const { DropboxConnectorProvider } = await import('../connectors/dropbox-connector.js');
          connector = new DropboxConnectorProvider();
        } else if (source.type === 'GDRIVE') {
          const { GoogleDriveConnectorProvider } = await import('../connectors/gdrive-connector.js');
          connector = new GoogleDriveConnectorProvider();
        }
        
        if (!connector) {
          throw new Error(`Unsupported source type: ${source.type}`);
        }
        
        // Fetch object using connector interface
        const fetchResult = await connector.fetchObject(obj.key, config, secrets);
        
        // Convert stream to buffer
        const chunks: Buffer[] = [];
        for await (const chunk of fetchResult.stream) {
          chunks.push(Buffer.from(chunk));
        }
        const fileBuffer = Buffer.concat(chunks);
        
        // Parse based on file extension
        const ext = obj.key.split('.').pop()?.toLowerCase() || '';
        let transcripts: any[] = [];
        
        if (ext === 'zip') {
          const { parseZipBatch } = await import('./parsers/zip-parser.js');
          const result = await parseZipBatch(fileBuffer);
          transcripts = result.transcripts || [];
        } else if (ext === 'jsonl') {
          const { parseJsonlBatch } = await import('./parsers/jsonl-parser.js');
          const result = await parseJsonlBatch(fileBuffer, obj.key);
          transcripts = result.transcripts || [];
        } else if (ext === 'csv') {
          const { parseCsvBatch } = await import('./parsers/csv-batch-parser.js');
          const result = await parseCsvBatch(fileBuffer, obj.key);
          transcripts = result.transcripts || [];
        }
        
        // Create conversations from transcripts
        if (transcripts.length > 0) {
          const { createConversationsFromCanonicalBatch } = await import('./canonical-to-conversation.js');
          const results = await createConversationsFromCanonicalBatch(
            schedule.org_id,
            '', // projectId - will need to get from schedule config
            'sandbox', // env - will need to get from schedule config
            schedule.created_by_user_id,
            transcripts,
            {
              templateId: schedule.template_id || null,
              mode: schedule.mode || 'AUDIO_PLUS_TRANSCRIPT',
              autoAnalyze: false,
            }
          );
          
          stats.parsed += results.filter(r => r.conversation_id).length;
          
          // Track processed object
          await supabaseAdmin
            .from('ingest_objects')
            .insert({
              source_id: source.id,
              object_key: obj.key,
              etag: obj.etag,
              status: 'PROCESSED',
              last_processed_at: new Date().toISOString(),
              conversation_id: results[0]?.conversation_id || null,
            });
          
          // Create import items
          for (const result of results) {
            importItems.push({
              import_id: importRecord.id,
              source_name: obj.key,
              status: result.conversation_id ? 'PARSED' : 'FAILED',
              conversation_id: result.conversation_id || null,
              error: result.warnings?.join('; ') || null,
            });
          }
        } else {
          stats.skipped++;
          await supabaseAdmin
            .from('ingest_objects')
            .insert({
              source_id: source.id,
              object_key: obj.key,
              etag: obj.etag,
              status: 'SKIPPED',
            });
        }
      } catch (error: any) {
        stats.failed++;
        console.error(`[Scheduler] Failed to process object ${obj.key}:`, error);
        
        // Track failed object
        await supabaseAdmin
          .from('ingest_objects')
          .insert({
            source_id: source.id,
            object_key: obj.key,
            etag: obj.etag,
            status: 'FAILED',
          });
        
        importItems.push({
          import_id: importRecord.id,
          source_name: obj.key,
          status: 'FAILED',
          error: error.message || 'Unknown error',
        });
      }
    }
    
    // Insert import items
    if (importItems.length > 0) {
      await supabaseAdmin
        .from('ingest_import_items')
        .insert(importItems);
    }
    
    // Update import record with final stats
    await supabaseAdmin
      .from('ingest_imports')
      .update({
        status: stats.failed === 0 ? 'COMPLETE' : stats.parsed > 0 ? 'PARTIAL' : 'FAILED',
        parsed_transcripts: stats.parsed,
        failed_items: stats.failed,
        completed_at: new Date().toISOString(),
      })
      .eq('id', importRecord.id);

    // Update schedule run
    await supabaseAdmin
      .from('ingest_schedule_runs')
      .update({
        status: 'COMPLETE',
        ended_at: new Date().toISOString(),
        stats_json: stats,
        import_id: importRecord.id,
      })
      .eq('id', run.id);

    // Update schedule next_run_at
    const nextRunAt = calculateNextRunTime(schedule.rrule);
    await supabaseAdmin
      .from('ingest_schedules')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAt,
      })
      .eq('id', schedule.id);

    console.log(`[Scheduler] Schedule ${schedule.name} completed successfully`);
  } catch (error: any) {
    // Update run with error
    await supabaseAdmin
      .from('ingest_schedule_runs')
      .update({
        status: 'FAILED',
        ended_at: new Date().toISOString(),
        log_text: error.message || 'Unknown error',
      })
      .eq('id', run.id);

    throw error;
  }
}

/**
 * List new objects from a source (not yet processed)
 */
async function listNewObjectsFromSource(source: any, schedule: any): Promise<any[]> {
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  // Get connector provider based on source type
  let connector: any = null;
  
  try {
    if (source.type === 'S3') {
      const { S3ConnectorProvider } = await import('../connectors/s3-connector.js');
      connector = new S3ConnectorProvider();
    } else if (source.type === 'DROPBOX') {
      const { DropboxConnectorProvider } = await import('../connectors/dropbox-connector.js');
      connector = new DropboxConnectorProvider();
    } else if (source.type === 'GDRIVE') {
      const { GoogleDriveConnectorProvider } = await import('../connectors/gdrive-connector.js');
      connector = new GoogleDriveConnectorProvider();
    } else {
      throw new Error(`Unsupported source type: ${source.type}`);
    }

    // Extract config and secrets from source.config_json
    const config = source.config_json.config || {};
    const secrets = source.config_json.secrets || {};

    // List objects from source using connector interface
    const listResult = await connector.list(
      { prefix: source.config_json.prefix || '', recursive: true },
      config,
      secrets
    );

    // Filter out already processed objects
    const newObjects: any[] = [];
    
    for (const obj of listResult.objects) {
      // Skip directories
      if (obj.isDirectory) continue;
      
      // Check if object already processed
      const { data: existing } = await supabaseAdmin
        .from('ingest_objects')
        .select('id')
        .eq('source_id', source.id)
        .eq('object_key', obj.path)
        .maybeSingle();

      if (!existing) {
        // New object - add to list
        newObjects.push({
          key: obj.path,
          size: obj.size,
          modified: obj.modifiedAt,
          etag: obj.metadata?.etag,
        });
      }
    }

    return newObjects;
  } catch (error: any) {
    console.error(`[Scheduler] Failed to list objects from source ${source.id}:`, error);
    throw error;
  }
}

/**
 * Calculate next run time from RRULE
 * Simple implementation - supports common patterns
 */
function calculateNextRunTime(rruleText: string): string {
  try {
    const now = new Date();
    let nextRun: Date;

    // Simple RRULE parsing - for production, use a proper RRULE library
    if (rruleText.includes('FREQ=HOURLY')) {
      nextRun = new Date(now.getTime() + 60 * 60 * 1000);
    } else if (rruleText.includes('FREQ=DAILY')) {
      nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    } else if (rruleText.includes('FREQ=WEEKLY')) {
      nextRun = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      // Default to 1 hour if parsing fails
      nextRun = new Date(now.getTime() + 60 * 60 * 1000);
    }

    return nextRun.toISOString();
  } catch (error: any) {
    console.error('[Scheduler] Failed to parse RRULE:', error);
    // Default to 1 hour from now if parsing fails
    return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }
}


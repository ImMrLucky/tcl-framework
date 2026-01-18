/**
 * Ingestion Configuration API Routes
 * 
 * Serves batch ingestion configuration to frontend
 */

import express from 'express';
import { getBatchIngestionConfig } from './batch-config.js';

/**
 * Setup ingestion configuration routes
 */
export function setupIngestionConfigRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/config/ingestion - Get ingestion configuration
  // ============================================================================
  app.get('/api/config/ingestion', async (req, res) => {
    try {
      const config = getBatchIngestionConfig();
      
      // Return configuration (sanitized for frontend)
      res.json({
        accepted_extensions: config.accepted_extensions,
        max_upload_size_mb: config.max_upload_size_mb,
        zip_rules: {
          transcript_extensions: config.zip_rules.transcript_extensions,
          audio_extensions: config.zip_rules.audio_extensions,
          metadata_extensions: config.zip_rules.metadata_extensions,
          require_transcript_for_audio: config.zip_rules.require_transcript_for_audio,
          allow_transcript_only: config.zip_rules.allow_transcript_only,
        },
        csv_contracts: config.csv_contracts.map(contract => ({
          id: contract.id,
          name: contract.name,
          type: contract.type,
          required_columns: contract.required_columns,
          optional_columns: contract.optional_columns,
        })),
        jsonl_config: {
          accept_canonical: config.jsonl_config.accept_canonical,
          accept_minimal: config.jsonl_config.accept_minimal,
        },
      });
    } catch (error: any) {
      console.error('Get ingestion config error:', error);
      res.status(500).json({ error: error.message || 'Unknown error' });
    }
  });
}


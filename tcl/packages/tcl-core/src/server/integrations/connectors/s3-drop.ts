/**
 * S3 Drop Ingest Connector
 * Polls S3 bucket for new files and ingests them as conversations
 */

import { IngestConnector, ConnectorContext } from './base.js';
import { supabaseAdmin } from '../server/supabase.js';
import * as AWS from 'aws-sdk';
import { parseEvidenceDocument } from '../artifacts/evidence-parser.js';

export class S3DropConnector extends IngestConnector {
  private s3Client: AWS.S3 | null = null;

  constructor(context: ConnectorContext) {
    super(context);
    this.initializeS3Client();
  }

  private initializeS3Client() {
    const accessKeyId = this.context.secrets.aws_access_key_id;
    const secretAccessKey = this.context.secrets.aws_secret_access_key;
    const region = this.context.config.region || 'us-east-1';

    if (!accessKeyId || !secretAccessKey) {
      console.warn('S3 credentials not configured');
      return;
    }

    this.s3Client = new AWS.S3({
      region,
      accessKeyId,
      secretAccessKey,
    });
  }

  async validateConfig(): Promise<{ valid: boolean; error?: string }> {
    const bucket = this.context.config.bucket;
    const accessKeyId = this.context.secrets.aws_access_key_id;
    const secretAccessKey = this.context.secrets.aws_secret_access_key;

    if (!bucket || typeof bucket !== 'string') {
      return { valid: false, error: 'Missing S3 bucket name' };
    }
    if (!accessKeyId || !secretAccessKey) {
      return { valid: false, error: 'Missing AWS credentials' };
    }
    return { valid: true };
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.s3Client) {
        this.initializeS3Client();
        if (!this.s3Client) {
          return { success: false, error: 'S3 client not initialized' };
        }
      }

      const bucket = this.context.config.bucket;
      await this.s3Client.listObjectsV2({
        Bucket: bucket,
        MaxKeys: 1,
      }).promise();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async execute(payload: any): Promise<{ success: boolean; data?: any; error?: string }> {
    const result = await this.ingest(payload);
    return {
      success: result.artifacts.length > 0,
      data: result,
      error: result.artifacts.length === 0 ? 'No files ingested' : undefined,
    };
  }

  async ingest(payload?: { since?: string; limit?: number }): Promise<{ conversationId: string; artifacts: string[] }> {
    if (!this.s3Client) {
      this.initializeS3Client();
      if (!this.s3Client) {
        throw new Error('S3 client not initialized');
      }
    }

    const bucket = this.context.config.bucket;
    const prefix = this.context.config.prefix || '';
    const limit = payload?.limit || 100;
    const since = payload?.since ? new Date(payload.since) : undefined;

    // List objects in bucket
    const response = await this.s3Client.listObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: limit,
    }).promise();
    
    const objects = response.Contents || [];

    // Filter by date if provided
    const filesToProcess = since
      ? objects.filter(obj => obj.LastModified && obj.LastModified > since)
      : objects;

    const artifacts: string[] = [];
    let conversationId: string | null = null;

    // Process each file
    for (const obj of filesToProcess) {
      if (!obj.Key) continue;

      try {
        // Download file
        const getResponse = await this.s3Client.getObject({
          Bucket: bucket,
          Key: obj.Key,
        }).promise();
        
        const content = getResponse.Body ? getResponse.Body.toString('utf-8') : '';

        // Parse file using evidence parser
        const parsed = await parseEvidenceDocument(
          content,
          obj.Key,
          getResponse.ContentType
        );

        if (!parsed) {
          console.warn(`Failed to parse file: ${obj.Key}`);
          continue;
        }
        
        const fileType = parsed.metadata.file_type;

        // Create or get conversation
        if (!conversationId) {
          const { data: conversation, error: convError } = await supabaseAdmin
            .from('conversations')
            .insert({
              org_id: this.context.orgId,
              project_id: this.context.projectId,
              env: this.context.env,
              external_id: obj.Key,
              title: this.extractTitle(obj.Key, parsed.text),
              content: parsed.text,
              raw_text: parsed.text,
              metadata: {
                source: 's3_drop',
                bucket,
                key: obj.Key,
                file_type: fileType,
                ingested_at: new Date().toISOString(),
              },
            })
            .select('id')
            .single();

          if (convError) {
            console.error(`Failed to create conversation: ${convError.message}`);
            continue;
          }

          conversationId = conversation.id;
        }

        // Determine artifact type based on file type
        let artifactType = 'transcript_text';
        if (fileType === 'json' && parsed.structured) {
          // Check if it's chat messages format
          if (Array.isArray(parsed.structured) || 
              (typeof parsed.structured === 'object' && parsed.structured.messages)) {
            artifactType = 'chat_messages';
          }
        }
        
        // Create artifact
        const { data: artifact, error: artError } = await supabaseAdmin
          .from('conversation_artifacts')
          .insert({
            conversation_id: conversationId,
            artifact_type: artifactType,
            content_text: parsed.text,
            content_json: parsed.structured || null,
            metadata: parsed.metadata,
          })
          .select('id')
          .single();

        if (artError) {
          console.error(`Failed to create artifact: ${artError.message}`);
          continue;
        }

        artifacts.push(artifact.id);
      } catch (error: any) {
        console.error(`Error processing file ${obj.Key}:`, error.message);
        continue;
      }
    }

    if (!conversationId) {
      throw new Error('No conversations created from S3 files');
    }

    return { conversationId, artifacts };
  }


  private extractTitle(key: string, text: string): string {
    // Try to extract title from filename
    const filename = key.split('/').pop() || key;
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
    
    // Or use first line of text if it looks like a title
    const firstLine = text.split('\n')[0]?.trim();
    if (firstLine && firstLine.length < 100 && !firstLine.includes(':')) {
      return firstLine;
    }
    
    return nameWithoutExt;
  }
}


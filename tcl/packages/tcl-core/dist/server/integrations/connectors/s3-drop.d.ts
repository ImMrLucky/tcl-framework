/**
 * S3 Drop Ingest Connector
 * Polls S3 bucket for new files and ingests them as conversations
 */
import { IngestConnector, ConnectorContext } from './base.js';
export declare class S3DropConnector extends IngestConnector {
    private s3Client;
    constructor(context: ConnectorContext);
    private initializeS3Client;
    validateConfig(): Promise<{
        valid: boolean;
        error?: string;
    }>;
    testConnection(): Promise<{
        success: boolean;
        error?: string;
    }>;
    execute(payload: any): Promise<{
        success: boolean;
        data?: any;
        error?: string;
    }>;
    ingest(payload?: {
        since?: string;
        limit?: number;
    }): Promise<{
        conversationId: string;
        artifacts: string[];
    }>;
    private extractTitle;
}

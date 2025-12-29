/**
 * Base Connector Interface
 * All integration connectors implement this interface
 */
import type { DeliveryAttempt } from '../types.js';
export interface ConnectorContext {
    orgId: string;
    projectId: string;
    env: 'sandbox' | 'production';
    integrationId: string;
    config: Record<string, any>;
    secrets: Record<string, string>;
}
export declare abstract class BaseConnector {
    protected context: ConnectorContext;
    constructor(context: ConnectorContext);
    /**
     * Validate connector configuration
     */
    abstract validateConfig(): Promise<{
        valid: boolean;
        error?: string;
    }>;
    /**
     * Test connector connection
     */
    abstract testConnection(): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Execute connector action (ingest, export, etc.)
     */
    abstract execute(payload: any): Promise<{
        success: boolean;
        data?: any;
        error?: string;
    }>;
}
/**
 * Ingest Connector - for bringing data in
 */
export declare abstract class IngestConnector extends BaseConnector {
    /**
     * Ingest data and create conversation artifacts
     */
    abstract ingest(payload: any): Promise<{
        conversationId: string;
        artifacts: string[];
    }>;
}
/**
 * Export Connector - for sending data out
 */
export declare abstract class ExportConnector extends BaseConnector {
    /**
     * Export evaluation results
     */
    abstract export(evaluationId: string, evaluationData: any): Promise<DeliveryAttempt>;
}

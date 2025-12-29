/**
 * Webhook Export Connector
 * Sends evaluation results to customer webhook endpoints
 */
import { ExportConnector } from './base.js';
import type { DeliveryAttempt } from '../types.js';
export declare class WebhookExportConnector extends ExportConnector {
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
    export(evaluationId: string, evaluationData: any): Promise<DeliveryAttempt>;
}

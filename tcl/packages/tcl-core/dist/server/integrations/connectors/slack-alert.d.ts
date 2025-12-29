/**
 * Slack Alert Connector
 * Sends alerts to Slack via incoming webhook
 */
import { ExportConnector } from './base.js';
import type { DeliveryAttempt } from '../types.js';
export declare class SlackAlertConnector extends ExportConnector {
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

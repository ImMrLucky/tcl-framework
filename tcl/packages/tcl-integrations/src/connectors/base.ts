/**
 * Base Connector Interface
 * All integration connectors implement this interface
 */

import type { IntegrationConfig, DeliveryAttempt } from '../types.js';

export interface ConnectorContext {
  orgId: string;
  projectId: string;
  env: 'sandbox' | 'production';
  integrationId: string;
  config: Record<string, any>;
  secrets: Record<string, string>;
}

export abstract class BaseConnector {
  protected context: ConnectorContext;

  constructor(context: ConnectorContext) {
    this.context = context;
  }

  /**
   * Validate connector configuration
   */
  abstract validateConfig(): Promise<{ valid: boolean; error?: string }>;

  /**
   * Test connector connection
   */
  abstract testConnection(): Promise<{ success: boolean; error?: string }>;

  /**
   * Execute connector action (ingest, export, etc.)
   */
  abstract execute(payload: any): Promise<{ success: boolean; data?: any; error?: string }>;
}

/**
 * Ingest Connector - for bringing data in
 */
export abstract class IngestConnector extends BaseConnector {
  /**
   * Ingest data and create conversation artifacts
   */
  abstract ingest(payload: any): Promise<{ conversationId: string; artifacts: string[] }>;
}

/**
 * Export Connector - for sending data out
 */
export abstract class ExportConnector extends BaseConnector {
  /**
   * Export evaluation results
   */
  abstract export(evaluationId: string, evaluationData: any): Promise<DeliveryAttempt>;

  /** Map a delivery attempt row to the connector execute() result shape. */
  protected deliveryResult(attempt: DeliveryAttempt): {
    success: boolean;
    data?: DeliveryAttempt;
    error?: string;
  } {
    return {
      success: attempt.status === 'success',
      data: attempt,
      error: attempt.error_message,
    };
  }
}


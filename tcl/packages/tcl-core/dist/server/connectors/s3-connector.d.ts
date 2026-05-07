import type { ConnectorProvider, ConnectorConfig, ConnectorSecrets, ListOptions, ListResult, ConnectorObject, FetchResult } from './connector-provider.js';
/**
 * S3 Connector Provider
 */
export declare class S3ConnectorProvider implements ConnectorProvider {
    testConnection(config: ConnectorConfig, secrets: ConnectorSecrets): Promise<{
        success: boolean;
        error?: string;
    }>;
    list(options: ListOptions, config: ConnectorConfig, secrets: ConnectorSecrets): Promise<ListResult>;
    fetchObject(ref: string, config: ConnectorConfig, secrets: ConnectorSecrets): Promise<FetchResult>;
    createBatchFromSelection(selection: ConnectorObject[], config: ConnectorConfig, secrets: ConnectorSecrets): Promise<{
        batchId: string;
        itemCount: number;
    }>;
}
export declare const s3Connector: S3ConnectorProvider;

import type { ConnectorProvider, ConnectorConfig, ConnectorSecrets, ListOptions, ListResult, ConnectorObject, FetchResult } from './connector-provider.js';
/**
 * Dropbox Connector Provider
 * Uses Dropbox API v2
 */
export declare class DropboxConnectorProvider implements ConnectorProvider {
    private getDropboxClient;
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
export declare const dropboxConnector: DropboxConnectorProvider;

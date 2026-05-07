import type { ConnectorProvider, ConnectorConfig, ConnectorSecrets, ListOptions, ListResult, ConnectorObject, FetchResult } from './connector-provider.js';
/**
 * Google Drive Connector Provider
 * Uses Google Drive API v3
 */
export declare class GoogleDriveConnectorProvider implements ConnectorProvider {
    private getAccessToken;
    private getDriveClient;
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
export declare const gdriveConnector: GoogleDriveConnectorProvider;

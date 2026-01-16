/**
 * Connector Provider Interface
 * Abstract interface for storage connectors (S3, Dropbox, GDrive, etc.)
 */

export interface ConnectorConfig {
  [key: string]: any;
}

export interface ConnectorSecrets {
  [key: string]: string;
}

export interface ListOptions {
  path?: string;
  prefix?: string;
  limit?: number;
  offset?: number;
  recursive?: boolean;
}

export interface ConnectorObject {
  id: string;
  name: string;
  path: string;
  size?: number;
  mimeType?: string;
  modifiedAt?: string;
  isDirectory?: boolean;
  metadata?: Record<string, any>;
}

export interface ListResult {
  objects: ConnectorObject[];
  hasMore: boolean;
  nextOffset?: number;
}

export interface FetchResult {
  stream: NodeJS.ReadableStream;
  metadata: {
    size: number;
    mimeType?: string;
    lastModified?: string;
  };
}

/**
 * Base interface for connector providers
 */
export interface ConnectorProvider {
  /**
   * Test connection with provided config and secrets
   */
  testConnection(config: ConnectorConfig, secrets: ConnectorSecrets): Promise<{ success: boolean; error?: string }>;

  /**
   * List objects at the given path/prefix
   */
  list(options: ListOptions, config: ConnectorConfig, secrets: ConnectorSecrets): Promise<ListResult>;

  /**
   * Fetch an object by reference (returns stream + metadata)
   */
  fetchObject(ref: string, config: ConnectorConfig, secrets: ConnectorSecrets): Promise<FetchResult>;

  /**
   * Create a batch from selected objects
   */
  createBatchFromSelection(
    selection: ConnectorObject[],
    config: ConnectorConfig,
    secrets: ConnectorSecrets
  ): Promise<{ batchId: string; itemCount: number }>;
}


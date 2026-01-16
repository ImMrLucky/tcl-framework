import type { ConnectorProvider, ConnectorConfig, ConnectorSecrets, ListOptions, ListResult, ConnectorObject, FetchResult } from './connector-provider.js';

/**
 * Google Drive Connector Provider
 * Uses Google Drive API v3
 */
export class GoogleDriveConnectorProvider implements ConnectorProvider {
  private getAccessToken(secrets: ConnectorSecrets): string {
    // In a real implementation, you'd refresh the token if needed
    return secrets.accessToken || secrets.refreshToken || '';
  }

  private async getDriveClient(secrets: ConnectorSecrets): Promise<any> {
    const accessToken = this.getAccessToken(secrets);

    if (!accessToken) {
      throw new Error('Missing Google Drive access token');
    }

    return {
      accessToken,
      async request(endpoint: string, options: RequestInit = {}) {
        const response = await fetch(`https://www.googleapis.com/drive/v3${endpoint}`, {
          ...options,
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
          throw new Error(error.error?.message || `Google Drive API error: ${response.status}`);
        }

        return response.json();
      },
    };
  }

  async testConnection(config: ConnectorConfig, secrets: ConnectorSecrets): Promise<{ success: boolean; error?: string }> {
    try {
      const client = await this.getDriveClient(secrets);

      // Test by getting about info
      await client.request('/about?fields=user');

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to connect to Google Drive' };
    }
  }

  async list(options: ListOptions, config: ConnectorConfig, secrets: ConnectorSecrets): Promise<ListResult> {
    const client = await this.getDriveClient(secrets);
    const folderId = options.path || options.prefix || 'root';
    const limit = options.limit || 100;
    const pageToken = options.offset ? String(options.offset) : undefined;

    // Build query
    let query = `'${folderId}' in parents and trashed=false`;
    
    // If recursive, don't filter by parent
    if (options.recursive && folderId !== 'root') {
      // For recursive, we'd need to use the Drive API's search with parents query
      // For now, just list the folder
      query = `'${folderId}' in parents and trashed=false`;
    }

    const params = new URLSearchParams({
      q: query,
      pageSize: limit.toString(),
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, parents)',
      orderBy: 'name',
    });

    if (pageToken) {
      params.append('pageToken', pageToken);
    }

    const response = await client.request(`/files?${params.toString()}`);

    const objects: ConnectorObject[] = [];

    if (response.files) {
      for (const file of response.files) {
        const isDirectory = file.mimeType === 'application/vnd.google-apps.folder';

        objects.push({
          id: file.id,
          name: file.name,
          path: file.id, // Use file ID as path
          size: file.size ? parseInt(file.size) : undefined,
          mimeType: file.mimeType,
          modifiedAt: file.modifiedTime,
          isDirectory,
          metadata: {
            parents: file.parents,
          },
        });
      }
    }

    return {
      objects,
      hasMore: !!response.nextPageToken,
      nextOffset: response.nextPageToken,
    };
  }

  async fetchObject(ref: string, config: ConnectorConfig, secrets: ConnectorSecrets): Promise<FetchResult> {
    const client = await this.getDriveClient(secrets);

    // Get file metadata first
    const fileMetadata = await client.request(`/files/${ref}?fields=id,name,mimeType,size,modifiedTime`);

    // Export or download based on file type
    let downloadUrl: string;
    
    // Google Workspace files (Docs, Sheets, etc.) need to be exported
    if (fileMetadata.mimeType?.startsWith('application/vnd.google-apps.')) {
      // Export as a common format (e.g., PDF for Docs, CSV for Sheets)
      const exportMimeType = getExportMimeType(fileMetadata.mimeType);
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${ref}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
    } else {
      // Regular files can be downloaded directly
      downloadUrl = `https://www.googleapis.com/drive/v3/files/${ref}?alt=media`;
    }

    // Download file
    const accessToken = this.getAccessToken(secrets);
    const response = await fetch(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(error.error?.message || `Google Drive download error: ${response.status}`);
    }

    return {
      stream: response.body as any,
      metadata: {
        size: fileMetadata.size ? parseInt(fileMetadata.size) : 0,
        mimeType: fileMetadata.mimeType,
        lastModified: fileMetadata.modifiedTime,
      },
    };
  }

  async createBatchFromSelection(
    selection: ConnectorObject[],
    config: ConnectorConfig,
    secrets: ConnectorSecrets
  ): Promise<{ batchId: string; itemCount: number }> {
    throw new Error('createBatchFromSelection should be called via batch ingestion API');
  }
}

/**
 * Get export MIME type for Google Workspace files
 */
function getExportMimeType(googleMimeType: string): string {
  const exportMap: Record<string, string> = {
    'application/vnd.google-apps.document': 'application/pdf',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'application/pdf',
    'application/vnd.google-apps.drawing': 'image/png',
  };

  return exportMap[googleMimeType] || 'application/pdf';
}

export const gdriveConnector = new GoogleDriveConnectorProvider();


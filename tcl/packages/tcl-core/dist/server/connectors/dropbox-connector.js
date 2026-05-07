/**
 * Dropbox Connector Provider
 * Uses Dropbox API v2
 */
export class DropboxConnectorProvider {
    getDropboxClient(accessToken) {
        // In a real implementation, you'd use the Dropbox SDK
        // For now, we'll use fetch to call the Dropbox API directly
        return {
            accessToken,
            async request(endpoint, body) {
                const response = await fetch(`https://api.dropboxapi.com/2${endpoint}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });
                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error_summary: 'Unknown error' }));
                    throw new Error(error.error_summary || `Dropbox API error: ${response.status}`);
                }
                return response.json();
            },
        };
    }
    async testConnection(config, secrets) {
        try {
            const { accessToken } = secrets;
            if (!accessToken) {
                return { success: false, error: 'Missing Dropbox access token' };
            }
            // Test by getting account info
            const client = this.getDropboxClient(accessToken);
            await client.request('/users/get_current_account', {});
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message || 'Failed to connect to Dropbox' };
        }
    }
    async list(options, config, secrets) {
        const { accessToken } = secrets;
        if (!accessToken) {
            throw new Error('Missing Dropbox access token');
        }
        const client = this.getDropboxClient(accessToken);
        const path = options.path || options.prefix || '';
        // Use files/list_folder
        const response = await client.request('/files/list_folder', {
            path: path || '',
            limit: options.limit || 100,
            recursive: options.recursive || false,
        });
        const objects = [];
        if (response.entries) {
            for (const entry of response.entries) {
                if (entry['.tag'] === 'folder') {
                    objects.push({
                        id: entry.path_lower || entry.path_display,
                        name: entry.name,
                        path: entry.path_display || entry.path_lower,
                        isDirectory: true,
                        modifiedAt: entry.server_modified,
                    });
                }
                else if (entry['.tag'] === 'file') {
                    objects.push({
                        id: entry.path_lower || entry.path_display,
                        name: entry.name,
                        path: entry.path_display || entry.path_lower,
                        size: entry.size,
                        mimeType: undefined, // Dropbox doesn't provide MIME type in list_folder
                        modifiedAt: entry.server_modified,
                        isDirectory: false,
                        metadata: {
                            contentHash: entry.content_hash,
                            rev: entry.rev,
                        },
                    });
                }
            }
        }
        return {
            objects,
            hasMore: response.has_more || false,
            nextOffset: response.cursor,
        };
    }
    async fetchObject(ref, config, secrets) {
        const { accessToken } = secrets;
        if (!accessToken) {
            throw new Error('Missing Dropbox access token');
        }
        // Use files/download to get file content
        const response = await fetch('https://content.dropboxapi.com/2/files/download', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Dropbox-API-Arg': JSON.stringify({ path: ref }),
            },
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error_summary: 'Unknown error' }));
            throw new Error(error.error_summary || `Dropbox download error: ${response.status}`);
        }
        // Get metadata from response headers
        const apiResultHeader = response.headers.get('dropbox-api-result');
        const metadata = apiResultHeader ? JSON.parse(apiResultHeader) : {};
        return {
            stream: response.body,
            metadata: {
                size: metadata.size || 0,
                mimeType: undefined, // Dropbox doesn't provide MIME type in download
                lastModified: metadata.server_modified,
            },
        };
    }
    async createBatchFromSelection(selection, config, secrets) {
        throw new Error('createBatchFromSelection should be called via batch ingestion API');
    }
}
export const dropboxConnector = new DropboxConnectorProvider();

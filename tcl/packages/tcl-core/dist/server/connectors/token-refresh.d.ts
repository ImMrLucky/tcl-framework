/**
 * Ensure Dropbox access token is fresh
 * Refreshes if expired or about to expire
 */
export declare function ensureDropboxAccessToken(orgId: string): Promise<{
    accessToken: string;
} | null>;
/**
 * Ensure Google Drive access token is fresh
 * Refreshes if expired or about to expire
 */
export declare function ensureGDriveAccessToken(orgId: string): Promise<{
    accessToken: string;
} | null>;

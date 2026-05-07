import { supabaseAdmin } from '../supabase.js';
import { decryptSecret, encryptSecret } from '../security/secret-crypto.js';
/**
 * Dropbox OAuth configuration
 */
const DROPBOX_CLIENT_ID = process.env.DROPBOX_CLIENT_ID;
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET;
/**
 * Google Drive OAuth configuration
 */
const GDRIVE_CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const GDRIVE_CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const GDRIVE_REDIRECT_URI = process.env.GDRIVE_REDIRECT_URI || `${process.env.__TCL_API_URL || 'http://localhost:8787'}/api/connectors/gdrive/oauth/callback`;
/**
 * Check if a token is expired or about to expire (within 5 minutes)
 */
function isTokenExpired(expiresAt) {
    if (!expiresAt) {
        return false; // No expiration info, assume valid
    }
    const expirationTime = new Date(expiresAt).getTime();
    const now = Date.now();
    const buffer = 5 * 60 * 1000; // 5 minutes buffer
    return expirationTime <= (now + buffer);
}
/**
 * Refresh Dropbox access token
 */
async function refreshDropboxToken(orgId, refreshToken) {
    if (!DROPBOX_CLIENT_ID || !DROPBOX_CLIENT_SECRET) {
        throw new Error('Dropbox OAuth not configured');
    }
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: DROPBOX_CLIENT_ID,
            client_secret: DROPBOX_CLIENT_SECRET,
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Dropbox token refresh error:', errorText);
        return null;
    }
    const tokens = await response.json();
    const { access_token, expires_in } = tokens;
    if (!access_token) {
        return null;
    }
    // Update stored access token
    const expiresAt = expires_in
        ? new Date(Date.now() + expires_in * 1000).toISOString()
        : undefined;
    if (supabaseAdmin) {
        try {
            const encryptedAccessToken = encryptSecret(access_token);
            await supabaseAdmin
                .from('integration_secrets')
                .upsert({
                org_id: orgId,
                integration_kind: 'DROPBOX',
                key: 'accessToken',
                ciphertext: encryptedAccessToken,
            }, {
                onConflict: 'org_id,integration_kind,key',
            });
            if (expiresAt) {
                const encryptedExpiresAt = encryptSecret(expiresAt);
                await supabaseAdmin
                    .from('integration_secrets')
                    .upsert({
                    org_id: orgId,
                    integration_kind: 'DROPBOX',
                    key: 'expiresAt',
                    ciphertext: encryptedExpiresAt,
                }, {
                    onConflict: 'org_id,integration_kind,key',
                });
            }
        }
        catch (error) {
            console.error('Failed to update Dropbox tokens:', error);
        }
    }
    return { accessToken: access_token, expiresAt };
}
/**
 * Refresh Google Drive access token
 */
async function refreshGDriveToken(orgId, refreshToken) {
    if (!GDRIVE_CLIENT_ID || !GDRIVE_CLIENT_SECRET) {
        throw new Error('Google Drive OAuth not configured');
    }
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: GDRIVE_CLIENT_ID,
            client_secret: GDRIVE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Google Drive token refresh error:', errorText);
        return null;
    }
    const tokens = await response.json();
    const { access_token, expires_in } = tokens;
    if (!access_token) {
        return null;
    }
    // Update stored access token
    const expiresAt = expires_in
        ? new Date(Date.now() + expires_in * 1000).toISOString()
        : undefined;
    if (supabaseAdmin) {
        try {
            const encryptedAccessToken = encryptSecret(access_token);
            await supabaseAdmin
                .from('integration_secrets')
                .upsert({
                org_id: orgId,
                integration_kind: 'GDRIVE',
                key: 'accessToken',
                ciphertext: encryptedAccessToken,
            }, {
                onConflict: 'org_id,integration_kind,key',
            });
            if (expiresAt) {
                const encryptedExpiresAt = encryptSecret(expiresAt);
                await supabaseAdmin
                    .from('integration_secrets')
                    .upsert({
                    org_id: orgId,
                    integration_kind: 'GDRIVE',
                    key: 'expiresAt',
                    ciphertext: encryptedExpiresAt,
                }, {
                    onConflict: 'org_id,integration_kind,key',
                });
            }
        }
        catch (error) {
            console.error('Failed to update Google Drive tokens:', error);
        }
    }
    return { accessToken: access_token, expiresAt };
}
/**
 * Ensure Dropbox access token is fresh
 * Refreshes if expired or about to expire
 */
export async function ensureDropboxAccessToken(orgId) {
    if (!supabaseAdmin) {
        return null;
    }
    // Get current tokens
    const { data: secrets, error } = await supabaseAdmin
        .from('integration_secrets')
        .select('key, ciphertext')
        .eq('org_id', orgId)
        .eq('integration_kind', 'DROPBOX')
        .in('key', ['accessToken', 'refreshToken', 'expiresAt']);
    if (error || !secrets || secrets.length === 0) {
        return null;
    }
    const secretsMap = {};
    for (const secret of secrets) {
        try {
            secretsMap[secret.key] = decryptSecret(secret.ciphertext);
        }
        catch (decryptError) {
            console.error(`Failed to decrypt Dropbox secret ${secret.key}:`, decryptError);
            return null;
        }
    }
    const accessToken = secretsMap['accessToken'];
    const refreshToken = secretsMap['refreshToken'];
    const expiresAt = secretsMap['expiresAt'];
    if (!accessToken) {
        return null;
    }
    // Check if token needs refresh
    if (isTokenExpired(expiresAt) && refreshToken) {
        console.log('Refreshing Dropbox access token...');
        const refreshed = await refreshDropboxToken(orgId, refreshToken);
        if (refreshed) {
            return { accessToken: refreshed.accessToken };
        }
        // If refresh failed, try using existing token (might still work)
    }
    return { accessToken };
}
/**
 * Ensure Google Drive access token is fresh
 * Refreshes if expired or about to expire
 */
export async function ensureGDriveAccessToken(orgId) {
    if (!supabaseAdmin) {
        return null;
    }
    // Get current tokens
    const { data: secrets, error } = await supabaseAdmin
        .from('integration_secrets')
        .select('key, ciphertext')
        .eq('org_id', orgId)
        .eq('integration_kind', 'GDRIVE')
        .in('key', ['accessToken', 'refreshToken', 'expiresAt']);
    if (error || !secrets || secrets.length === 0) {
        return null;
    }
    const secretsMap = {};
    for (const secret of secrets) {
        try {
            secretsMap[secret.key] = decryptSecret(secret.ciphertext);
        }
        catch (decryptError) {
            console.error(`Failed to decrypt Google Drive secret ${secret.key}:`, decryptError);
            return null;
        }
    }
    const accessToken = secretsMap['accessToken'];
    const refreshToken = secretsMap['refreshToken'];
    const expiresAt = secretsMap['expiresAt'];
    if (!accessToken) {
        return null;
    }
    // Check if token needs refresh
    if (isTokenExpired(expiresAt) && refreshToken) {
        console.log('Refreshing Google Drive access token...');
        const refreshed = await refreshGDriveToken(orgId, refreshToken);
        if (refreshed) {
            return { accessToken: refreshed.accessToken };
        }
        // If refresh failed, try using existing token (might still work)
    }
    return { accessToken };
}

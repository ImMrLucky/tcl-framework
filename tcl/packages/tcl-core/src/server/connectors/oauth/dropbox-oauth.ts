import express from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../../supabase.js';
import { getOrgContext } from '../../auth-context.js';
import { requireEntitlement } from '../../entitlements/middleware.js';
import { logAudit } from '../../supabase.js';
import { encryptSecret } from '../../security/secret-crypto.js';

/**
 * Dropbox OAuth configuration
 */
const DROPBOX_CLIENT_ID = process.env.DROPBOX_CLIENT_ID;
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET;
const DROPBOX_REDIRECT_URI = process.env.DROPBOX_REDIRECT_URI || `${process.env.__TCL_API_URL || 'http://localhost:8787'}/api/connectors/dropbox/oauth/callback`;

/**
 * Generate a random state token for OAuth CSRF protection
 */
function generateStateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Setup Dropbox OAuth routes
 */
export function setupDropboxOAuthRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/connectors/dropbox/oauth/start - Start OAuth flow
  // ============================================================================
  app.get(
    '/api/connectors/dropbox/oauth/start',
    requireEntitlement('batchIngestion'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        if (!DROPBOX_CLIENT_ID) {
          return res.status(500).json({ error: 'Dropbox OAuth not configured (DROPBOX_CLIENT_ID missing)' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Generate state token
        const stateToken = generateStateToken();

        // Store state in database with TTL
        const { error: stateError } = await supabaseAdmin
          .from('oauth_states')
          .insert({
            org_id: context.orgId,
            user_id: context.userId,
            provider: 'DROPBOX',
            state_token: stateToken,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
            redirect_url: req.query.redirect_url as string | undefined,
          });

        if (stateError) {
          console.error('Failed to store OAuth state:', stateError);
          return res.status(500).json({ error: 'Failed to initialize OAuth flow' });
        }

        // Build Dropbox OAuth URL
        const authUrl = new URL('https://www.dropbox.com/oauth2/authorize');
        authUrl.searchParams.set('client_id', DROPBOX_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', DROPBOX_REDIRECT_URI);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('state', stateToken);
        authUrl.searchParams.set('token_access_type', 'offline'); // Request refresh token

        // Return OAuth URL as JSON (for popup window)
        res.json({ oauthUrl: authUrl.toString() });
      } catch (error: any) {
        console.error('Dropbox OAuth start error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );

  // ============================================================================
  // GET /api/connectors/dropbox/oauth/callback - OAuth callback
  // ============================================================================
  app.get(
    '/api/connectors/dropbox/oauth/callback',
    async (req, res) => {
      try {
        const { code, state, error: oauthError } = req.query;

        if (oauthError) {
          return res.send(`
            <html>
              <body>
                <h1>OAuth Error</h1>
                <p>${oauthError}</p>
                <script>
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
        }

        if (!code || !state) {
          return res.send(`
            <html>
              <body>
                <h1>OAuth Error</h1>
                <p>Missing code or state parameter</p>
                <script>
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
        }

        if (!supabaseAdmin) {
          return res.send(`
            <html>
              <body>
                <h1>Error</h1>
                <p>Supabase not configured</p>
                <script>
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
        }

        // Verify state token
        const { data: stateData, error: stateError } = await supabaseAdmin
          .from('oauth_states')
          .select('*')
          .eq('state_token', state as string)
          .gt('expires_at', new Date().toISOString())
          .single();

        if (stateError || !stateData) {
          return res.send(`
            <html>
              <body>
                <h1>OAuth Error</h1>
                <p>Invalid or expired state token</p>
                <script>
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
        }

        // Delete used state token
        await supabaseAdmin
          .from('oauth_states')
          .delete()
          .eq('state_token', state as string);

        // Exchange code for tokens
        if (!DROPBOX_CLIENT_ID || !DROPBOX_CLIENT_SECRET) {
          return res.send(`
            <html>
              <body>
                <h1>Error</h1>
                <p>Dropbox OAuth not configured</p>
                <script>
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
        }

        const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            code: code as string,
            grant_type: 'authorization_code',
            redirect_uri: DROPBOX_REDIRECT_URI,
            client_id: DROPBOX_CLIENT_ID,
            client_secret: DROPBOX_CLIENT_SECRET,
          }),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error('Dropbox token exchange error:', errorText);
          return res.send(`
            <html>
              <body>
                <h1>OAuth Error</h1>
                <p>Failed to exchange code for tokens</p>
                <script>
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
        }

        const tokens = await tokenResponse.json();
        const { access_token, refresh_token, expires_in } = tokens;

        if (!access_token) {
          return res.send(`
            <html>
              <body>
                <h1>OAuth Error</h1>
                <p>No access token received</p>
                <script>
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
        }

        // Store tokens in integration_secrets (encrypted)
        const expiresAt = expires_in 
          ? new Date(Date.now() + expires_in * 1000).toISOString()
          : null;

        const secretsToStore = [
          { key: 'accessToken', value: access_token },
          ...(refresh_token ? [{ key: 'refreshToken', value: refresh_token }] : []),
          ...(expiresAt ? [{ key: 'expiresAt', value: expiresAt }] : []),
        ];

        for (const { key, value } of secretsToStore) {
          try {
            const encryptedValue = encryptSecret(value);
            await supabaseAdmin
              .from('integration_secrets')
              .upsert({
                org_id: stateData.org_id,
                integration_kind: 'DROPBOX',
                key,
                ciphertext: encryptedValue,
              }, {
                onConflict: 'org_id,integration_kind,key',
              });
          } catch (encryptError: any) {
            console.error(`Failed to store Dropbox secret ${key}:`, encryptError);
          }
        }

        // Log audit
        await logAudit({
          orgId: stateData.org_id,
          actorUserId: stateData.user_id,
          action: 'connector.dropbox.connect',
          targetType: 'integration_secret',
          meta: { hasRefreshToken: !!refresh_token },
        });

        // Return success page that closes window
        const redirectUrl = stateData.redirect_url || '/bulk-ingest';
        return res.send(`
          <html>
            <body>
              <h1>Success!</h1>
              <p>Dropbox connection successful. This window will close automatically.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'dropbox_oauth_success' }, '*');
                  setTimeout(() => window.close(), 1000);
                } else {
                  window.location.href = '${redirectUrl}';
                }
              </script>
            </body>
          </html>
        `);
      } catch (error: any) {
        console.error('Dropbox OAuth callback error:', error);
        return res.send(`
          <html>
            <body>
              <h1>Error</h1>
              <p>${error.message || 'Unknown error'}</p>
              <script>
                setTimeout(() => window.close(), 3000);
              </script>
            </body>
          </html>
        `);
      }
    }
  );

  // ============================================================================
  // POST /api/connectors/dropbox/disconnect - Disconnect Dropbox
  // ============================================================================
  app.post(
    '/api/connectors/dropbox/disconnect',
    requireEntitlement('batchIngestion'),
    async (req, res) => {
      try {
        const context = await getOrgContext(req);
        
        if (!context || context.error || !context.orgId || !context.userId) {
          return res.status(401).json({ error: context?.error || 'Authorization required' });
        }

        if (!supabaseAdmin) {
          return res.status(503).json({ error: 'Supabase not configured' });
        }

        // Delete all Dropbox secrets for this org
        const { error: deleteError } = await supabaseAdmin
          .from('integration_secrets')
          .delete()
          .eq('org_id', context.orgId)
          .eq('integration_kind', 'DROPBOX');

        if (deleteError) {
          console.error('Failed to delete Dropbox secrets:', deleteError);
          return res.status(500).json({ error: 'Failed to disconnect Dropbox' });
        }

        // Log audit
        await logAudit({
          orgId: context.orgId,
          actorUserId: context.userId,
          action: 'connector.dropbox.disconnect',
          targetType: 'integration_secret',
        });

        res.json({ success: true });
      } catch (error: any) {
        console.error('Dropbox disconnect error:', error);
        res.status(500).json({ error: error.message || 'Unknown error' });
      }
    }
  );
}


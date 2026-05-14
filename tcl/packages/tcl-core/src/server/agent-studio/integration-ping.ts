import type express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { decryptString } from './crypto.js';
import { bufFromDb } from './bytea.js';
import { logAgentStudioAudit } from './audit.js';

export interface PingOrgContext {
  orgId: string;
  userId?: string;
}

/**
 * Test an integration connection using stored (decrypted) credentials.
 * Jira Cloud: GET /rest/api/3/myself with Bearer token.
 * Azure DevOps: GET https://dev.azure.com/{org}/_apis/projects?api-version=7.0 with Basic PAT.
 */
export async function handleIntegrationPing(
  req: express.Request,
  res: express.Response,
  ctx: PingOrgContext
): Promise<void> {
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Supabase not configured' });
    return;
  }
  const { id } = req.params;
  const { data: row, error } = await supabaseAdmin
    .from('agent_studio_integrations')
    .select('*')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (error || !row) {
    res.status(404).json({ error: 'Integration not found' });
    return;
  }

  let creds: Record<string, unknown> = {};
  if (row.credentials_ciphertext && row.credentials_iv && row.credentials_tag) {
    try {
      const json = decryptString({
        ciphertext: bufFromDb(row.credentials_ciphertext),
        iv: bufFromDb(row.credentials_iv),
        tag: bufFromDb(row.credentials_tag),
      });
      creds = JSON.parse(json) as Record<string, unknown>;
    } catch (e: unknown) {
      res.status(500).json({ error: 'Failed to decrypt credentials', message: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  const config = (row.config || {}) as Record<string, unknown>;
  const kind = String(row.kind);

  try {
    if (kind === 'jira') {
      const baseUrl = String(config.baseUrl || config.site || '').replace(/\/$/, '');
      const token = String(creds.token || creds.apiToken || creds.password || '');
      if (!baseUrl || !token) {
        res.status(400).json({ error: 'Jira requires config.baseUrl (or site) and credentials.token' });
        return;
      }
      const email = String(creds.email || creds.user || '');
      const authHeader =
        email && token
          ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
          : `Bearer ${token}`;
      const r = await fetch(`${baseUrl}/rest/api/3/myself`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        res.status(502).json({ ok: false, status: r.status, provider: 'jira', error: body });
        return;
      }
      await logAgentStudioAudit({
        orgId: ctx.orgId,
        teamId: row.team_id,
        actorUserId: ctx.userId,
        eventType: 'integration.ping',
        resourceType: 'agent_studio_integrations',
        resourceId: id,
        payload: { kind: 'jira', ok: true },
      });
      res.json({ ok: true, provider: 'jira', accountId: (body as { accountId?: string }).accountId });
      return;
    }

    if (kind === 'azure-devops') {
      const orgName = String(config.organization || config.org || '');
      const pat = String(creds.pat || creds.token || '');
      if (!orgName || !pat) {
        res.status(400).json({ error: 'Azure DevOps requires config.organization and credentials.pat' });
        return;
      }
      const basic = Buffer.from(`:${pat}`).toString('base64');
      const r = await fetch(`https://dev.azure.com/${encodeURIComponent(orgName)}/_apis/projects?api-version=7.0`, {
        headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        res.status(502).json({ ok: false, status: r.status, provider: 'azure-devops', error: body });
        return;
      }
      await logAgentStudioAudit({
        orgId: ctx.orgId,
        teamId: row.team_id,
        actorUserId: ctx.userId,
        eventType: 'integration.ping',
        resourceType: 'agent_studio_integrations',
        resourceId: id,
        payload: { kind: 'azure-devops', ok: true },
      });
      res.json({ ok: true, provider: 'azure-devops', count: (body as { count?: number })?.count });
      return;
    }

    res.status(501).json({
      ok: false,
      error: `Ping not implemented for kind "${kind}". Supported: jira, azure-devops.`,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: message });
  }
}

/**
 * Template packs, DB role/persona templates, template assets, agent markdown files,
 * and prompt preview — generic Agent Studio platform routes.
 */

import type express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext, type OrgContext } from '../auth-context.js';
import { loadRoleTemplates, loadPersonaTemplates } from './templates.js';
import {
  BUILTIN_ROLE_TEMPLATES,
  BUILTIN_PERSONA_TEMPLATES,
} from './generated-agent-catalog.js';
import { composeAgentPrompt } from './prompt-composer.js';
import { appendAgentFileVersion } from './agent-files.js';
import { logAgentStudioAudit } from './audit.js';
import { ensureSystemTemplatesSeeded } from './seed-system-templates.js';

const STAFF_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER']);
const ANALYST_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'ANALYST']);

type Ctx = OrgContext & { orgId: string };

async function ensure(req: express.Request, res: express.Response): Promise<Ctx | null> {
  const c = await getOrgContext(req);
  if (!c || (c as any).error || !c.orgId) {
    res.status(401).json({ error: (c as any)?.error || 'Authorization required' });
    return null;
  }
  return c as Ctx;
}

function staff(c: Ctx, res: express.Response): boolean {
  if (!c.role || !STAFF_ROLES.has(c.role)) {
    res.status(403).json({ error: 'INSUFFICIENT_ROLE', requires: 'OWNER, ADMIN, or MANAGER' });
    return false;
  }
  return true;
}

function analyst(c: Ctx, res: express.Response): boolean {
  if (!c.role || !ANALYST_ROLES.has(c.role)) {
    res.status(403).json({ error: 'INSUFFICIENT_ROLE', requires: 'OWNER, ADMIN, MANAGER, or ANALYST' });
    return false;
  }
  return true;
}

function dbDown(res: express.Response): boolean {
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Supabase not configured' });
    return true;
  }
  return false;
}

export function registerAgentStudioTemplateFileRoutes(app: express.Application): void {
  app.get('/api/agent-studio/template-packs', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_template_packs')
      .select('*')
      .or(`org_id.is.null,org_id.eq.${c.orgId}`)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ packs: data ?? [] });
  });

  app.get('/api/agent-studio/template-packs/:id', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    const { id } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_template_packs')
      .select('*')
      .eq('id', id)
      .or(`org_id.is.null,org_id.eq.${c.orgId}`)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ pack: data });
  });

  app.post('/api/agent-studio/template-packs', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !staff(c, res) || dbDown(res)) return;
    const { key, name, description, category, packType, metadata } = req.body ?? {};
    if (!key || !name) return res.status(400).json({ error: 'key and name are required' });
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_template_packs')
      .insert({
        org_id: c.orgId,
        key,
        name,
        description: description ?? null,
        category: category ?? 'custom',
        pack_type: packType ?? 'custom',
        is_system: false,
        is_active: true,
        metadata: metadata ?? {},
        created_by: c.userId ?? null,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ pack: data });
  });

  app.get('/api/agent-studio/roles', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    let { data, error } = await supabaseAdmin!
      .from('agent_studio_role_templates')
      .select('*')
      .or(`org_id.is.null,org_id.eq.${c.orgId}`)
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    // No system rows yet? Seed once and re-query so the user immediately gets data.
    if (!data || data.length === 0) {
      await ensureSystemTemplatesSeeded(supabaseAdmin!);
      const re = await supabaseAdmin!
        .from('agent_studio_role_templates')
        .select('*')
        .or(`org_id.is.null,org_id.eq.${c.orgId}`)
        .order('name', { ascending: true });
      if (!re.error) data = re.data;
    }

    const catalog = loadRoleTemplates();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      catalog: catalog.length > 0 ? catalog : ([...(BUILTIN_ROLE_TEMPLATES as any)] as typeof catalog),
      dbRoles: data ?? [],
    });
  });

  app.get('/api/agent-studio/personas', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    let { data, error } = await supabaseAdmin!
      .from('agent_studio_persona_templates')
      .select('*')
      .or(`org_id.is.null,org_id.eq.${c.orgId}`)
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    if (!data || data.length === 0) {
      await ensureSystemTemplatesSeeded(supabaseAdmin!);
      const re = await supabaseAdmin!
        .from('agent_studio_persona_templates')
        .select('*')
        .or(`org_id.is.null,org_id.eq.${c.orgId}`)
        .order('name', { ascending: true });
      if (!re.error) data = re.data;
    }

    const catalog = loadPersonaTemplates();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      catalog: catalog.length > 0 ? catalog : ([...(BUILTIN_PERSONA_TEMPLATES as any)] as typeof catalog),
      dbPersonas: data ?? [],
    });
  });

  app.get('/api/agent-studio/template-assets', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_template_assets')
      .select('*')
      .or(`org_id.is.null,org_id.eq.${c.orgId}`)
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ assets: data ?? [] });
  });

  app.get('/api/agent-studio/agents/:agentId/files', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    const { agentId } = req.params;
    const { data: agent } = await supabaseAdmin!
      .from('agent_studio_agents')
      .select('id')
      .eq('id', agentId)
      .eq('org_id', c.orgId)
      .maybeSingle();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_files')
      .select('*')
      .eq('agent_id', agentId)
      .eq('org_id', c.orgId)
      .order('file_path', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ files: data ?? [] });
  });

  app.patch('/api/agent-studio/agents/:agentId/files/:fileId', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    const { agentId, fileId } = req.params;
    const { markdown, isActive, changeNote } = req.body ?? {};
    const { data: row, error: gErr } = await supabaseAdmin!
      .from('agent_studio_agent_files')
      .select('*')
      .eq('id', fileId)
      .eq('agent_id', agentId)
      .eq('org_id', c.orgId)
      .maybeSingle();
    if (gErr) return res.status(500).json({ error: gErr.message });
    if (!row) return res.status(404).json({ error: 'File not found' });
    const allowed: Record<string, unknown> = { last_modified_by: c.userId ?? null };
    if (markdown !== undefined) allowed.markdown = markdown;
    if (isActive !== undefined) allowed.is_active = !!isActive;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_files')
      .update(allowed)
      .eq('id', fileId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (typeof markdown === 'string') {
      await appendAgentFileVersion({
        supabase: supabaseAdmin!,
        orgId: c.orgId,
        agentFileId: fileId,
        markdown,
        changeNote: changeNote ?? null,
        userId: c.userId ?? null,
      });
    }
    await logAgentStudioAudit({
      orgId: c.orgId,
      teamId: row.team_id,
      agentId,
      actorUserId: c.userId,
      eventType: 'agent.file.update',
      resourceType: 'agent_studio_agent_files',
      resourceId: fileId,
      payload: { filePath: row.file_path },
    });
    res.json({ file: data });
  });

  app.get('/api/agent-studio/agents/:agentId/files/:fileId/versions', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    const { agentId, fileId } = req.params;
    const { data: f } = await supabaseAdmin!
      .from('agent_studio_agent_files')
      .select('id')
      .eq('id', fileId)
      .eq('agent_id', agentId)
      .eq('org_id', c.orgId)
      .maybeSingle();
    if (!f) return res.status(404).json({ error: 'File not found' });
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_agent_file_versions')
      .select('*')
      .eq('agent_file_id', fileId)
      .eq('org_id', c.orgId)
      .order('version', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ versions: data ?? [] });
  });

  app.post('/api/agent-studio/agents/:agentId/prompt-preview', async (req, res) => {
    const c = await ensure(req, res);
    if (!c || !analyst(c, res) || dbDown(res)) return;
    const { agentId } = req.params;
    const { taskId, activeFilePath, activeFileContent, selectedText, userPrompt } = req.body ?? {};
    const { data: agent } = await supabaseAdmin!
      .from('agent_studio_agents')
      .select('team_id')
      .eq('id', agentId)
      .eq('org_id', c.orgId)
      .maybeSingle();
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    const composed = await composeAgentPrompt({
      supabase: supabaseAdmin!,
      orgId: c.orgId,
      teamId: agent.team_id,
      agentId,
      taskId: taskId ?? null,
      userPrompt: typeof userPrompt === 'string' ? userPrompt : '',
      activeFilePath: activeFilePath ?? null,
      activeFileContent: activeFileContent ?? null,
      selectedText: selectedText ?? null,
    });
    const composedPrompt = [composed.systemPrompt, composed.userPrompt].filter(Boolean).join('\n\n--- user ---\n\n');
    res.json({
      filesUsed: composed.filesUsed,
      composedPrompt,
    });
  });
}

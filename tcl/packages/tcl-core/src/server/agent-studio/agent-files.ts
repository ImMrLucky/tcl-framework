/**
 * Default per-agent Markdown files (OpenClaw-style bundle) seeded from
 * `packages/agent-core/templates/assets/generic/*.md`.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findRoleTemplate } from './templates.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERIC_DIR = resolve(HERE, '../../../../agent-core/templates/assets/generic');

export type AgentFileType =
  | 'agent'
  | 'persona'
  | 'instructions'
  | 'rules'
  | 'tools'
  | 'memory'
  | 'context'
  | 'workflow'
  | 'review_gates'
  | 'handoff'
  | 'heartbeat'
  | 'output_format'
  | 'custom';

export const DEFAULT_AGENT_FILE_SPECS: Array<{
  path: string;
  fileType: AgentFileType;
  fileKey: string;
  required: boolean;
}> = [
  { path: 'agent.md', fileType: 'agent', fileKey: 'agent', required: true },
  { path: 'persona.md', fileType: 'persona', fileKey: 'persona', required: true },
  { path: 'instructions.md', fileType: 'instructions', fileKey: 'instructions', required: true },
  { path: 'rules.md', fileType: 'rules', fileKey: 'rules', required: true },
  { path: 'tools.md', fileType: 'tools', fileKey: 'tools', required: false },
  { path: 'memory.md', fileType: 'memory', fileKey: 'memory', required: false },
  { path: 'context.md', fileType: 'context', fileKey: 'context', required: false },
  { path: 'workflow.md', fileType: 'workflow', fileKey: 'workflow', required: true },
  { path: 'review-gates.md', fileType: 'review_gates', fileKey: 'review_gates', required: true },
  { path: 'handoff.md', fileType: 'handoff', fileKey: 'handoff', required: false },
  { path: 'heartbeat.md', fileType: 'heartbeat', fileKey: 'heartbeat', required: false },
  { path: 'output-format.md', fileType: 'output_format', fileKey: 'output_format', required: true },
];

function readGenericFile(relativePath: string): string {
  try {
    return readFileSync(resolve(GENERIC_DIR, relativePath), 'utf8');
  } catch {
    return '';
  }
}

function interpolateMarkdown(raw: string, vars: Record<string, string>): string {
  let out = raw;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

export async function resolveTemplatePackId(
  supabase: SupabaseClient,
  packKey: string | null | undefined
): Promise<string | null> {
  const key = (packKey || 'generic_agent_setup').trim();
  const { data } = await supabase
    .from('agent_studio_template_packs')
    .select('id')
    .is('org_id', null)
    .eq('key', key)
    .maybeSingle();
  return data?.id ?? null;
}

export async function seedDefaultAgentMarkdownFiles(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  agentId: string;
  agentName: string;
  roleTemplateKey: string | null;
  personaText: string | null;
  userId: string | null;
}): Promise<void> {
  const roleTpl = opts.roleTemplateKey ? findRoleTemplate(opts.roleTemplateKey) : null;
  const roleName = roleTpl?.name ?? opts.roleTemplateKey ?? 'Custom role';
  const vars: Record<string, string> = {
    agentName: opts.agentName,
    roleName,
  };

  for (const spec of DEFAULT_AGENT_FILE_SPECS) {
    let md = readGenericFile(spec.path);
    if (spec.fileType === 'persona' && opts.personaText?.trim()) {
      md = `# Persona (from setup)\n\n${opts.personaText.trim()}\n\n---\n\n${md}`;
    }
    md = interpolateMarkdown(md, vars);
    const { data: inserted, error } = await opts.supabase
      .from('agent_studio_agent_files')
      .insert({
        org_id: opts.orgId,
        team_id: opts.teamId,
        agent_id: opts.agentId,
        file_key: spec.fileKey,
        file_name: spec.path,
        file_path: spec.path,
        file_type: spec.fileType,
        markdown: md,
        is_required: spec.required,
        is_active: true,
        created_by: opts.userId,
        last_modified_by: opts.userId,
      })
      .select('id')
      .single();
    if (error) {
      console.warn('[agent-studio][agent-files] insert failed', spec.path, error.message);
      continue;
    }
    await opts.supabase.from('agent_studio_agent_file_versions').insert({
      org_id: opts.orgId,
      agent_file_id: inserted.id,
      version: 1,
      markdown: md,
      change_note: 'initial',
      created_by: opts.userId,
    });
  }
}

export async function appendAgentFileVersion(opts: {
  supabase: SupabaseClient;
  orgId: string;
  agentFileId: string;
  markdown: string;
  changeNote?: string | null;
  userId: string | null;
}): Promise<number> {
  const { data: rows } = await opts.supabase
    .from('agent_studio_agent_file_versions')
    .select('version')
    .eq('agent_file_id', opts.agentFileId)
    .order('version', { ascending: false })
    .limit(1);
  const next = ((rows?.[0] as { version?: number } | undefined)?.version ?? 0) + 1;
  await opts.supabase.from('agent_studio_agent_file_versions').insert({
    org_id: opts.orgId,
    agent_file_id: opts.agentFileId,
    version: next,
    markdown: opts.markdown,
    change_note: opts.changeNote ?? null,
    created_by: opts.userId,
  });
  return next;
}

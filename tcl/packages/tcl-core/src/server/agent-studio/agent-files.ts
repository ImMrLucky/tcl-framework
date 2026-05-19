/**
 * Default per-agent Markdown files (OpenClaw-style bundle) seeded from
 * `packages/agent-core/templates/assets/generic/*.md`.
 */

import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUILTIN_GENERIC_AGENT_FILES } from './generated-agent-generic-files.js';
import { findRoleTemplate } from './templates.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

function candidateGenericDirs(): string[] {
  const dirs: string[] = [];
  dirs.push(join(HERE, 'agent-generic-md'));
  try {
    const pkg = nodeRequire.resolve('@protectqa/agent-core/package.json');
    dirs.push(join(dirname(pkg), 'templates', 'assets', 'generic'));
  } catch {
    /* optional */
  }
  dirs.push(resolve(HERE, '../../../../agent-core/templates/assets/generic'));
  const cwd = process.cwd();
  dirs.push(resolve(cwd, 'packages/agent-core/templates/assets/generic'));
  dirs.push(resolve(cwd, '../agent-core/templates/assets/generic'));
  return [...new Set(dirs)];
}

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
  const embedded = BUILTIN_GENERIC_AGENT_FILES[relativePath];
  if (typeof embedded === 'string' && embedded.trim()) {
    return embedded;
  }
  for (const dir of candidateGenericDirs()) {
    const full = join(dir, relativePath);
    if (existsSync(full)) {
      try {
        return readFileSync(full, 'utf8');
      } catch {
        /* try next */
      }
    }
  }
  return embedded ?? '';
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
  /** When true, fill empty markdown on existing rows and insert only missing paths. */
  repairExisting?: boolean;
}): Promise<{ inserted: number; repaired: number; skipped: number }> {
  const roleTpl = opts.roleTemplateKey ? findRoleTemplate(opts.roleTemplateKey) : null;
  const roleName = roleTpl?.name ?? opts.roleTemplateKey ?? 'Custom role';
  const rolePersona =
    opts.personaText?.trim() || roleTpl?.defaultPersona?.trim() || '';
  const vars: Record<string, string> = {
    agentName: opts.agentName,
    roleName,
    roleKey: opts.roleTemplateKey ?? 'custom',
    roleDescription:
      roleTpl?.description ??
      'Deliver assigned work with clear acceptance criteria, evidence, and safe collaboration.',
    rolePersona:
      rolePersona ||
      'Be clear, professional, evidence-driven, and explicit about assumptions and risks.',
    capabilities: (roleTpl?.defaultCapabilities?.length
      ? roleTpl.defaultCapabilities.join(', ')
      : 'analyze, plan, execute, review, document') as string,
    tools: (roleTpl?.defaultTools?.length
      ? roleTpl.defaultTools.join(', ')
      : 'read_repo, read_board, write_board, post_comment') as string,
    orchestratorMode: roleTpl?.isOrchestrator
      ? 'This agent may orchestrate other specialists. Delegate implementation; own planning, routing, and review gates.'
      : 'This agent executes work in its specialty. Escalate cross-cutting decisions to the orchestrator or a human.',
  };

  let inserted = 0;
  let repaired = 0;
  let skipped = 0;

  for (const spec of DEFAULT_AGENT_FILE_SPECS) {
    let md = readGenericFile(spec.path);
    if (spec.fileType === 'persona') {
      const personaBlocks: string[] = [];
      if (opts.personaText?.trim()) {
        personaBlocks.push(
          `## Persona override (from agent setup)\n\n${opts.personaText.trim()}`
        );
      }
      if (roleTpl?.defaultPersona?.trim() && roleTpl.defaultPersona.trim() !== opts.personaText?.trim()) {
        personaBlocks.push(
          `## Role template persona ({{roleName}})\n\n${roleTpl.defaultPersona.trim()}`
        );
      }
      if (personaBlocks.length > 0) {
        md = `${personaBlocks.join('\n\n')}\n\n---\n\n${md}`;
      }
    }
    md = interpolateMarkdown(md, vars);
    if (!md.trim()) {
      console.warn('[agent-studio][agent-files] empty template for', spec.path);
      skipped++;
      continue;
    }

    if (opts.repairExisting) {
      const { data: existing } = await opts.supabase
        .from('agent_studio_agent_files')
        .select('id, markdown')
        .eq('agent_id', opts.agentId)
        .eq('org_id', opts.orgId)
        .eq('file_path', spec.path)
        .maybeSingle();
      if (existing) {
        const current = ((existing as { markdown?: string }).markdown ?? '').trim();
        const stale =
          !current ||
          current.length < Math.min(400, Math.floor(md.length * 0.35));
        if (stale) {
          await opts.supabase
            .from('agent_studio_agent_files')
            .update({
              markdown: md,
              last_modified_by: opts.userId,
            })
            .eq('id', existing.id);
          await appendAgentFileVersion({
            supabase: opts.supabase,
            orgId: opts.orgId,
            agentFileId: existing.id,
            markdown: md,
            changeNote: current ? 'upgraded template content' : 'repaired empty seed',
            userId: opts.userId,
          });
          repaired++;
        } else {
          skipped++;
        }
        continue;
      }
    }

    const { data: insertedRow, error } = await opts.supabase
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
      skipped++;
      continue;
    }
    inserted++;
    await opts.supabase.from('agent_studio_agent_file_versions').insert({
      org_id: opts.orgId,
      agent_file_id: insertedRow.id,
      version: 1,
      markdown: md,
      change_note: 'initial',
      created_by: opts.userId,
    });
  }
  return { inserted, repaired, skipped };
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

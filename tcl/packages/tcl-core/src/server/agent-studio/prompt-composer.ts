import type { SupabaseClient } from '@supabase/supabase-js';
import { findRoleTemplate } from './templates.js';

const FILE_ORDER = [
  'agent',
  'persona',
  'instructions',
  'rules',
  'tools',
  'workflow',
  'review_gates',
  'output_format',
  'memory',
  'context',
  'handoff',
  'heartbeat',
] as const;

export type FileUsed = { fileName: string; fileType: string; filePath: string };

export async function composeAgentPrompt(input: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  agentId: string;
  taskId?: string | null;
  userPrompt: string;
  activeFilePath?: string | null;
  activeFileContent?: string | null;
  selectedText?: string | null;
}): Promise<{ systemPrompt: string; userPrompt: string; filesUsed: FileUsed[] }> {
  const { data: agent } = await input.supabase
    .from('agent_studio_agents')
    .select('*')
    .eq('id', input.agentId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (!agent) throw new Error('Agent not found');

  const { data: fileRows } = await input.supabase
    .from('agent_studio_agent_files')
    .select('file_name, file_path, file_type, markdown, is_active, is_required')
    .eq('agent_id', input.agentId)
    .eq('org_id', input.orgId);

  const byType = new Map<string, string>();
  const filesUsed: FileUsed[] = [];
  for (const row of fileRows ?? []) {
    const r = row as {
      file_name: string;
      file_path: string;
      file_type: string;
      markdown: string;
      is_active: boolean;
      is_required: boolean;
    };
    if (!r.is_active && !r.is_required) continue;
    byType.set(r.file_type, r.markdown ?? '');
    filesUsed.push({ fileName: r.file_name, fileType: r.file_type, filePath: r.file_path });
  }

  const sections: string[] = [];
  const rk = agent.role_template_key as string | null;
  const role = rk ? findRoleTemplate(rk) : null;
  sections.push(
    `# Runtime\nAgent: ${agent.name}\nRole template: ${role?.name ?? agent.role_template_key ?? 'custom'}`
  );

  for (const ft of FILE_ORDER) {
    const body = byType.get(ft);
    if (!body?.trim()) continue;
    const title = ft.replace(/_/g, ' ');
    sections.push(`# ${title} (agent file: ${ft})\n\n${body.trim()}`);
  }

  if (input.taskId) {
    const { data: task } = await input.supabase
      .from('agent_studio_tasks')
      .select('*')
      .eq('id', input.taskId)
      .eq('org_id', input.orgId)
      .maybeSingle();
    if (task) {
      const t = task as Record<string, unknown>;
      const meta = (t.metadata as Record<string, unknown>) || {};
      const ac = meta.acceptanceCriteria ?? meta.acceptance_criteria;
      sections.push(
        `# Current task\n\n**${t.title}**\n\n${t.description ?? ''}\n\n**Acceptance criteria:**\n${typeof ac === 'string' ? ac : JSON.stringify(ac ?? {}, null, 2)}`
      );
    }
  }

  const { data: teamCtx } = await input.supabase
    .from('agent_studio_contexts')
    .select('key, content')
    .eq('org_id', input.orgId)
    .eq('team_id', input.teamId)
    .eq('scope', 'TEAM')
    .order('pinned', { ascending: false })
    .limit(12);
  if (teamCtx?.length) {
    const blob = teamCtx
      .map((c: { key: string; content: string | null }) => `## ${c.key}\n${c.content ?? ''}`)
      .join('\n\n');
    sections.push(`# Team shared context\n\n${blob}`);
  }

  const { data: mistakes } = await input.supabase
    .from('agent_studio_mistakes')
    .select('title, description, rule, severity')
    .eq('team_id', input.teamId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(15);
  if (mistakes?.length) {
    const mlines = (
      mistakes as { title: string; description: string | null; rule: string; severity: string }[]
    )
      .map((m) => `- **${m.title}** (${m.severity}): ${m.description ?? ''} — rule: ${m.rule}`)
      .join('\n');
    sections.push(`# Active mistakes / rules to respect\n\n${mlines}`);
  }

  if (input.activeFilePath && input.activeFileContent) {
    sections.push(
      `# Active workspace file: ${input.activeFilePath}\n\n\`\`\`\n${String(input.activeFileContent).slice(0, 120000)}\n\`\`\``
    );
  }
  if (input.selectedText?.trim()) {
    sections.push(`# Selected text\n\n\`\`\`\n${input.selectedText.trim().slice(0, 32000)}\n\`\`\``);
  }

  const systemPrompt = sections.join('\n\n---\n\n');
  const userPrompt = input.userPrompt.trim() || '(no additional user message)';
  return { systemPrompt, userPrompt, filesUsed };
}

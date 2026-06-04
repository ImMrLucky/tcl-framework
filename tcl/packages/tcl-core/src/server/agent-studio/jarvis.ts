import type { SupabaseClient } from '@supabase/supabase-js';
import { seedDefaultAgentMarkdownFiles } from './agent-files.js';
import { appendTeamEvent } from './team-events.js';
import { assignDefaultModelFromOrgKeys } from './model-routing.js';

export const JARVIS_AGENT_NAME = 'Jarvis';
export const JARVIS_ROLE_KEY = 'agent_manager';

const JARVIS_AGENT_MD_PREAMBLE = `# Agent: Jarvis

## Role

You are Jarvis, the team orchestrator.

## Mission

Coordinate the agent team, keep work moving, maintain shared context, identify blockers, and ensure all work follows board policy and review gates.

## Responsibilities

- Read the shared team JSONL event log before acting.
- Understand current board state.
- Assign tasks to the best available agent.
- Ask agents for updates when they are stale.
- Detect blocked tasks and propose unblockers.
- Move work forward only when allowed.
- Create review gates when required.
- Escalate unclear decisions to the human user.
- Summarize team progress.
- Update shared context after important events.

## Rules

- Never bypass global/team/agent pause.
- Never mark work done unless review requirements are satisfied.
- Never invent task status.
- Never overwrite another agent's work without review.
- Never call external tools unless allowed.
- Prefer small, safe next actions.

---

`;

/**
 * Ensure team has exactly one orchestrator named Jarvis (unless one already exists).
 */
export async function provisionJarvisForTeam(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  userId: string | null;
  teamName?: string;
}): Promise<{ agentId: string; created: boolean } | null> {
  const { data: existing } = await opts.supabase
    .from('agent_studio_agents')
    .select('id, name, is_orchestrator')
    .eq('team_id', opts.teamId)
    .eq('org_id', opts.orgId)
    .eq('is_orchestrator', true)
    .maybeSingle();

  if (existing?.id) {
    return { agentId: existing.id as string, created: false };
  }

  const persona =
    'You are Jarvis, the team orchestrator. You read the shared JSONL log, manage the board, assign work, detect blockers, and respect review gates and pause state.';

  const { data: agent, error } = await opts.supabase
    .from('agent_studio_agents')
    .insert({
      org_id: opts.orgId,
      team_id: opts.teamId,
      name: JARVIS_AGENT_NAME,
      role_template_key: JARVIS_ROLE_KEY,
      is_orchestrator: true,
      persona,
      status: 'IDLE',
      capabilities: ['plan', 'delegate', 'escalate', 'summarize'],
      tools: ['read_repo', 'read_board', 'write_board', 'post_comment'],
      created_by: opts.userId,
    })
    .select('id')
    .single();

  if (error || !agent) {
    console.warn('[agent-studio][jarvis] create failed', error?.message);
    return null;
  }

  const agentId = agent.id as string;

  try {
    await seedDefaultAgentMarkdownFiles({
      supabase: opts.supabase,
      orgId: opts.orgId,
      teamId: opts.teamId,
      agentId,
      agentName: JARVIS_AGENT_NAME,
      roleTemplateKey: JARVIS_ROLE_KEY,
      personaText: persona,
      userId: opts.userId,
    });
    const { data: personaFile } = await opts.supabase
      .from('agent_studio_agent_files')
      .select('id, markdown')
      .eq('agent_id', agentId)
      .eq('file_path', 'agent.md')
      .maybeSingle();
    if (personaFile?.id) {
      const md = `${JARVIS_AGENT_MD_PREAMBLE}${(personaFile as { markdown?: string }).markdown ?? ''}`;
      await opts.supabase
        .from('agent_studio_agent_files')
        .update({ markdown: md })
        .eq('id', personaFile.id);
    }
  } catch (e) {
    console.warn('[agent-studio][jarvis] seed files skipped', e);
  }

  await opts.supabase.from('agent_studio_agent_private_context').upsert(
    {
      org_id: opts.orgId,
      team_id: opts.teamId,
      agent_id: agentId,
      summary: 'Jarvis orchestrator — monitors board, assigns tasks, coordinates reviews.',
      memory: { role: 'orchestrator' },
    },
    { onConflict: 'agent_id' }
  );

  await appendTeamEvent({
    supabase: opts.supabase,
    orgId: opts.orgId,
    teamId: opts.teamId,
    eventType: 'jarvis.provisioned',
    actorType: 'SYSTEM',
    actorName: JARVIS_AGENT_NAME,
    summary: `Jarvis orchestrator provisioned for team ${opts.teamName ?? opts.teamId}`,
    agentId,
    jsonl: { roleKey: JARVIS_ROLE_KEY },
  });

  try {
    await assignDefaultModelFromOrgKeys({
      supabase: opts.supabase,
      orgId: opts.orgId,
      teamId: opts.teamId,
      agentId,
      isOrchestrator: true,
      preferredProvider: 'openai',
    });
  } catch (e) {
    console.warn('[agent-studio][jarvis] default model assignment skipped', e);
  }

  return { agentId, created: true };
}

export async function getJarvisAgentId(
  supabase: SupabaseClient,
  orgId: string,
  teamId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('agent_studio_agents')
    .select('id')
    .eq('org_id', orgId)
    .eq('team_id', teamId)
    .eq('is_orchestrator', true)
    .maybeSingle();
  return data?.id ?? null;
}

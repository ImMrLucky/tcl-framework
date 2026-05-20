/**
 * Team-in-a-box presets: pick a team type → provision agents, board columns, and config files.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logAgentStudioAudit } from './audit.js';
import { seedDefaultAgentMarkdownFiles, resolveTemplatePackId } from './agent-files.js';
import { provisionJarvisForTeam, JARVIS_ROLE_KEY } from './jarvis.js';
import { appendTeamEvent } from './team-events.js';
import {
  findPersonaTemplate,
  findRoleTemplate,
  findWorkflowTemplate,
  type WorkflowTemplate,
} from './templates.js';

export type WorkItemKind = 'APP_IDEA' | 'STORY' | 'TASK';

export interface TeamBoxAgentSlot {
  roleTemplateKey: string;
  /** Override display name; defaults to role template name. */
  displayName?: string;
  personaTemplateKey?: string;
}

export interface TeamBoxDefinition {
  key: string;
  name: string;
  description: string;
  icon: string;
  workflowTemplateKey: string;
  templatePackKey: string;
  agents: TeamBoxAgentSlot[];
  exampleObjective: string;
}

export const TEAM_BOX_CATALOG: TeamBoxDefinition[] = [
  {
    key: 'mobile_dev',
    name: 'Mobile App Development',
    description:
      'Product, UX, architecture, engineering, and QA agents configured for iOS/Android delivery with Jarvis coordinating the board.',
    icon: 'phone_iphone',
    workflowTemplateKey: 'generic_software_delivery',
    templatePackKey: 'generic_software_delivery',
    agents: [
      { roleTemplateKey: 'product_owner' },
      { roleTemplateKey: 'ux_designer' },
      { roleTemplateKey: 'software_architect' },
      { roleTemplateKey: 'senior_software_engineer' },
      { roleTemplateKey: 'qa_engineer' },
    ],
    exampleObjective:
      'Deliver the mobile app MVP: refine backlog stories, implement core flows, and prepare a testable build.',
  },
  {
    key: 'web_app',
    name: 'Web App Development',
    description:
      'Full-stack web team with frontend, backend, architecture, and QA — ready to ship features from idea to done.',
    icon: 'language',
    workflowTemplateKey: 'generic_software_delivery',
    templatePackKey: 'generic_software_delivery',
    agents: [
      { roleTemplateKey: 'product_owner' },
      { roleTemplateKey: 'ux_designer' },
      { roleTemplateKey: 'software_architect' },
      { roleTemplateKey: 'frontend_engineer' },
      { roleTemplateKey: 'backend_engineer' },
      { roleTemplateKey: 'qa_engineer' },
    ],
    exampleObjective:
      'Build and ship the next web feature: clarify requirements, implement UI + API, and validate in QA.',
  },
  {
    key: 'ai_team',
    name: 'AI / ML Team',
    description:
      'Research, data science, architecture, and engineering agents for AI products — spec-first delivery with review gates.',
    icon: 'psychology',
    workflowTemplateKey: 'research_spec_build_review',
    templatePackKey: 'generic_software_delivery',
    agents: [
      { roleTemplateKey: 'product_owner' },
      { roleTemplateKey: 'researcher' },
      { roleTemplateKey: 'data_scientist' },
      { roleTemplateKey: 'software_architect' },
      { roleTemplateKey: 'senior_software_engineer' },
      { roleTemplateKey: 'qa_engineer' },
    ],
    exampleObjective:
      'Research, spec, and implement the AI capability: document findings, define acceptance criteria, and deliver an integrated solution.',
  },
  {
    key: 'gaming_dev',
    name: 'Game Development',
    description:
      'Create games from zero — Roblox (Luau), Unity (C#), Godot, or web. Game design, scripting, UX, architecture, and playtest QA with Jarvis coordinating delivery.',
    icon: 'sports_esports',
    workflowTemplateKey: 'generic_software_delivery',
    templatePackKey: 'gaming_dev',
    agents: [
      { roleTemplateKey: 'product_owner', displayName: 'Game Producer' },
      { roleTemplateKey: 'game_designer' },
      { roleTemplateKey: 'game_artist_ux' },
      { roleTemplateKey: 'software_architect', displayName: 'Technical Director' },
      { roleTemplateKey: 'game_developer' },
      { roleTemplateKey: 'qa_engineer', displayName: 'Playtest / QA' },
    ],
    exampleObjective:
      'Ship a playable vertical slice: lock platform & language, document core loop in a GDD, implement core mechanics, and pass playtest acceptance.',
  },
];

export function findTeamBox(key: string): TeamBoxDefinition | null {
  return TEAM_BOX_CATALOG.find((b) => b.key === key) ?? null;
}

function agentDisplayName(slot: TeamBoxAgentSlot): string {
  if (slot.displayName?.trim()) return slot.displayName.trim();
  const role = findRoleTemplate(slot.roleTemplateKey);
  return role?.name ?? slot.roleTemplateKey;
}

async function provisionAgentFromSlot(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  userId: string | null;
  slot: TeamBoxAgentSlot;
  templatePackKey: string;
}): Promise<{ agentId: string; name: string } | null> {
  if (opts.slot.roleTemplateKey === JARVIS_ROLE_KEY) return null;

  const role = findRoleTemplate(opts.slot.roleTemplateKey);
  const name = agentDisplayName(opts.slot);
  const personaKey = opts.slot.personaTemplateKey ?? role?.defaultPersona;
  let personaFinal: string | null = null;
  if (personaKey) {
    const pt = findPersonaTemplate(personaKey);
    if (pt) personaFinal = pt.personaMarkdown;
  }

  let template_pack_id: string | null = null;
  try {
    template_pack_id = await resolveTemplatePackId(opts.supabase, opts.templatePackKey);
  } catch {
    /* migration 050 optional */
  }

  const { data, error } = await opts.supabase
    .from('agent_studio_agents')
    .insert({
      org_id: opts.orgId,
      team_id: opts.teamId,
      name,
      role_template_key: opts.slot.roleTemplateKey,
      is_orchestrator: false,
      persona: personaFinal,
      theme: {},
      capabilities: role?.defaultCapabilities ?? [],
      tools: role?.defaultTools ?? [],
      created_by: opts.userId,
      template_pack_id,
    })
    .select('id')
    .single();
  if (error) {
    console.warn('[team-box] agent insert failed', opts.slot.roleTemplateKey, error.message);
    return null;
  }

  try {
    await seedDefaultAgentMarkdownFiles({
      supabase: opts.supabase,
      orgId: opts.orgId,
      teamId: opts.teamId,
      agentId: data.id as string,
      agentName: name,
      roleTemplateKey: opts.slot.roleTemplateKey,
      personaText: personaFinal,
      userId: opts.userId,
    });
  } catch (e) {
    console.warn('[team-box] seed agent files skipped', e);
  }

  return { agentId: data.id as string, name };
}

async function applyWorkflowBoardColumns(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  workflow: WorkflowTemplate;
}): Promise<void> {
  const { data: board } = await opts.supabase
    .from('agent_studio_boards')
    .select('id')
    .eq('team_id', opts.teamId)
    .eq('org_id', opts.orgId)
    .eq('is_default', true)
    .maybeSingle();
  if (!board?.id || !opts.workflow.defaultBoardColumns?.length) return;

  await opts.supabase
    .from('agent_studio_boards')
    .update({ columns: opts.workflow.defaultBoardColumns })
    .eq('id', board.id)
    .eq('org_id', opts.orgId);
}

/**
 * After team + board exist: Jarvis, specialist agents, board columns, optional starter context.
 */
export async function provisionTeamBox(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  userId: string | null;
  teamBoxKey: string;
  teamName: string;
  skipJarvis?: boolean;
}): Promise<{
  jarvisAgentId: string | null;
  agents: Array<{ agentId: string; name: string; roleTemplateKey: string }>;
}> {
  const box = findTeamBox(opts.teamBoxKey);
  if (!box) {
    throw new Error(`Unknown team box: ${opts.teamBoxKey}`);
  }

  const workflow = findWorkflowTemplate(box.workflowTemplateKey);
  if (workflow) {
    await applyWorkflowBoardColumns({
      supabase: opts.supabase,
      orgId: opts.orgId,
      teamId: opts.teamId,
      workflow,
    });
  }

  let jarvisAgentId: string | null = null;
  if (opts.skipJarvis !== true) {
    const jarvis = await provisionJarvisForTeam({
      supabase: opts.supabase,
      orgId: opts.orgId,
      teamId: opts.teamId,
      userId: opts.userId,
      teamName: opts.teamName,
    });
    jarvisAgentId = jarvis?.agentId ?? null;
  }

  const agents: Array<{ agentId: string; name: string; roleTemplateKey: string }> = [];
  for (const slot of box.agents) {
    const created = await provisionAgentFromSlot({
      supabase: opts.supabase,
      orgId: opts.orgId,
      teamId: opts.teamId,
      userId: opts.userId,
      slot,
      templatePackKey: box.templatePackKey,
    });
    if (created) {
      agents.push({
        agentId: created.agentId,
        name: created.name,
        roleTemplateKey: slot.roleTemplateKey,
      });
    }
  }

  await opts.supabase.from('agent_studio_contexts').insert({
    org_id: opts.orgId,
    scope: 'TEAM',
    team_id: opts.teamId,
    key: 'team_box',
    content: `${box.name} team provisioned.`,
    data: {
      teamBoxKey: box.key,
      workflowTemplateKey: box.workflowTemplateKey,
      agentCount: agents.length + (jarvisAgentId ? 1 : 0),
    },
    source: 'workflow',
    created_by: opts.userId,
  });

  if (box.key === 'gaming_dev') {
    await opts.supabase.from('agent_studio_contexts').insert({
      org_id: opts.orgId,
      scope: 'TEAM',
      team_id: opts.teamId,
      key: 'gaming_platform_guide',
      content: [
        'Default platform guidance for new game teams:',
        '- Roblox: Luau in Roblox Studio; use services, RemoteEvents, and DataStores carefully.',
        '- Unity: C# scripts + scenes; prefer a small vertical slice before polish.',
        '- Godot: GDScript; scene tree and signals for gameplay.',
        '- Web / casual: use the stack already in the repo (e.g. Phaser, Three.js).',
        'If the user did not pick a platform, the Game Producer + Technical Director choose one and document it in team context before heavy implementation.',
      ].join('\n'),
      data: { stacks: ['roblox_luau', 'unity_csharp', 'godot_gdscript', 'web'] },
      source: 'workflow',
      created_by: opts.userId,
    });
  }

  await appendTeamEvent({
    supabase: opts.supabase,
    orgId: opts.orgId,
    teamId: opts.teamId,
    eventType: 'team_box.provisioned',
    actorType: 'SYSTEM',
    actorName: 'agent-studio',
    summary: `Team in a box "${box.name}" provisioned with ${agents.length} specialist(s) and Jarvis.`,
    jsonl: { teamBoxKey: box.key, agents: agents.map((a) => a.name) },
  });

  await logAgentStudioAudit({
    orgId: opts.orgId,
    teamId: opts.teamId,
    actorUserId: opts.userId,
    eventType: 'team_box.provision',
    resourceType: 'agent_studio_teams',
    resourceId: opts.teamId,
    payload: { teamBoxKey: box.key, agentCount: agents.length, jarvisAgentId },
  });

  return { jarvisAgentId, agents };
}

export async function buildTeamObjectiveFromBacklog(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  taskIds?: string[];
}): Promise<string> {
  let q = opts.supabase
    .from('agent_studio_tasks')
    .select('id, title, description, column_key, task_type, metadata, priority')
    .eq('team_id', opts.teamId)
    .eq('org_id', opts.orgId)
    .neq('status', 'DONE')
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: true })
    .limit(40);

  if (opts.taskIds?.length) {
    q = q.in('id', opts.taskIds);
  } else {
    q = q.in('column_key', ['backlog', 'ready', 'intake', 'research', 'spec']);
  }

  const { data: tasks } = await q;
  if (!tasks?.length) {
    return '';
  }

  const lines: string[] = ['Work to deliver:', ''];
  for (const t of tasks) {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    const kind = (meta.workItemKind as string) || t.task_type;
    const parent = meta.parentTaskId ? ' (child)' : '';
    lines.push(`- [${kind}]${parent} ${t.title}${t.description ? `: ${String(t.description).slice(0, 200)}` : ''}`);
  }
  return lines.join('\n');
}

export function workItemTaskType(kind: WorkItemKind): string {
  switch (kind) {
    case 'APP_IDEA':
      return 'SPEC';
    case 'STORY':
      return 'STORY';
    case 'TASK':
    default:
      return 'CHORE';
  }
}

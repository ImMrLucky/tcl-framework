/**
 * Team-in-a-box + simplified work assignment + Start Working.
 */

import type express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { logAgentStudioAudit } from './audit.js';
import { readPauseGate } from './pause-gate.js';
import { appendTeamEvent } from './team-events.js';
import { getJarvisAgentId } from './jarvis.js';
import {
  TEAM_BOX_CATALOG,
  buildTeamObjectiveFromBacklog,
  findTeamBox,
  provisionTeamBox,
  workItemTaskType,
  type WorkItemKind,
} from './team-box.js';
import {
  buildJarvisWorkPlan,
  recommendTeamBox,
  type DeliveryMode,
  type PlannedWorkItem,
} from './team-intake.js';
import type { OrgContext } from '../auth-context.js';
import type { PauseGateState } from './pause-gate.js';

type RouteCtx = {
  ensureContext: (req: express.Request, res: express.Response) => Promise<OrgContext | null>;
  requireStaff: (ctx: OrgContext, res: express.Response) => boolean;
  requireAnalyst: (ctx: OrgContext, res: express.Response) => boolean;
  dbDown: (res: express.Response) => boolean;
  blockedByPause: (res: express.Response, gate: PauseGateState) => boolean;
};

export function registerTeamBoxRoutes(app: express.Application, ctx: RouteCtx): void {
  app.post('/api/agent-studio/team-boxes/recommend', async (req, res) => {
    const orgCtx = await ctx.ensureContext(req, res);
    if (!orgCtx || ctx.dbDown(res)) return;
    const { idea, requirements } = req.body ?? {};
    if (!idea?.trim()) return res.status(400).json({ error: 'idea is required' });
    const recommendation = recommendTeamBox(String(idea).trim(), requirements?.trim());
    const planPreview = buildJarvisWorkPlan({
      idea: String(idea).trim(),
      requirements: requirements?.trim(),
      deliveryMode: recommendation.deliveryMode,
      teamBox: findTeamBox(recommendation.teamBoxKey),
    });
    res.json({ recommendation, planPreview });
  });

  app.get('/api/agent-studio/team-boxes', async (req, res) => {
    const orgCtx = await ctx.ensureContext(req, res);
    if (!orgCtx || ctx.dbDown(res)) return;
    res.json({
      boxes: TEAM_BOX_CATALOG.map((b) => ({
        key: b.key,
        name: b.name,
        description: b.description,
        icon: b.icon,
        workflowTemplateKey: b.workflowTemplateKey,
        exampleObjective: b.exampleObjective,
        agentRoleCount: b.agents.length,
      })),
    });
  });

  app.post('/api/agent-studio/teams/from-box', async (req, res) => {
    const orgCtx = await ctx.ensureContext(req, res);
    if (!orgCtx || !ctx.requireStaff(orgCtx, res) || ctx.dbDown(res)) return;

    const {
      name,
      description,
      projectId,
      teamBoxKey,
      appIdeaTitle,
      appIdeaDescription,
      idea,
      requirements,
      autoPlan,
      deliveryMode,
      startWorking,
    } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (!teamBoxKey) return res.status(400).json({ error: 'teamBoxKey is required' });
    const box = findTeamBox(String(teamBoxKey));
    if (!box) return res.status(400).json({ error: 'Unknown teamBoxKey' });

    const { data: team, error: teamErr } = await supabaseAdmin!
      .from('agent_studio_teams')
      .insert({
        org_id: orgCtx.orgId,
        project_id: projectId ?? null,
        name: name.trim(),
        description: description?.trim() || box.description,
        workflow_template_key: box.workflowTemplateKey,
        created_by: orgCtx.userId ?? null,
      })
      .select('*')
      .single();
    if (teamErr) return res.status(500).json({ error: teamErr.message });

    const { data: board, error: boardErr } = await supabaseAdmin!
      .from('agent_studio_boards')
      .insert({ org_id: orgCtx.orgId, team_id: team.id })
      .select('*')
      .single();
    if (boardErr) return res.status(500).json({ error: boardErr.message });

    let provisioned: Awaited<ReturnType<typeof provisionTeamBox>>;
    try {
      provisioned = await provisionTeamBox({
        supabase: supabaseAdmin!,
        orgId: orgCtx.orgId,
        teamId: team.id,
        userId: orgCtx.userId ?? null,
        teamBoxKey: box.key,
        teamName: team.name,
      });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }

    const ideaText = (idea ?? appIdeaTitle)?.trim();
    const reqText = (requirements ?? appIdeaDescription)?.trim();

    let appIdeaTask: Record<string, unknown> | null = null;
    let planResult: { plan: ReturnType<typeof buildJarvisWorkPlan>; tasks: Record<string, unknown>[] } | null =
      null;

    if (autoPlan === true && ideaText) {
      planResult = await applyJarvisWorkPlan({
        orgId: orgCtx.orgId,
        teamId: team.id,
        userId: orgCtx.userId ?? null,
        idea: ideaText,
        requirements: reqText,
        deliveryMode: deliveryMode as DeliveryMode | undefined,
        teamBoxKey: box.key,
      });
      appIdeaTask = planResult.tasks[0] ?? null;
    } else if (ideaText) {
      appIdeaTask = await insertWorkItem({
        orgId: orgCtx.orgId,
        teamId: team.id,
        userId: orgCtx.userId ?? null,
        kind: 'APP_IDEA',
        title: ideaText,
        description: reqText,
      });
    }

    await logAgentStudioAudit({
      orgId: orgCtx.orgId,
      teamId: team.id,
      actorUserId: orgCtx.userId,
      eventType: 'team.create_from_box',
      resourceType: 'agent_studio_teams',
      resourceId: team.id,
      payload: { teamBoxKey: box.key, name: team.name },
    });

    let run: Record<string, unknown> | null = null;
    if (startWorking === true) {
      const objective =
        (await buildTeamObjectiveFromBacklog({
          supabase: supabaseAdmin!,
          orgId: orgCtx.orgId,
          teamId: team.id,
        })) || box.exampleObjective;
      run = await queueTeamRun({
        orgId: orgCtx.orgId,
        teamId: team.id,
        userId: orgCtx.userId ?? null,
        objective,
        runMode: 'RUN_UNTIL_BLOCKED',
        maxSteps: 50,
      });
    }

    res.status(201).json({
      team,
      board,
      teamBoxKey: box.key,
      jarvisAgentId: provisioned.jarvisAgentId,
      agents: provisioned.agents,
      appIdeaTask,
      plan: planResult?.plan ?? null,
      plannedTasks: planResult?.tasks ?? [],
      run,
    });
  });

  app.post('/api/agent-studio/teams/:teamId/plan-work', async (req, res) => {
    const orgCtx = await ctx.ensureContext(req, res);
    if (!orgCtx || !ctx.requireAnalyst(orgCtx, res) || ctx.dbDown(res)) return;
    const { teamId } = req.params;
    const gate = await readPauseGate({ orgId: orgCtx.orgId, teamId });
    if (ctx.blockedByPause(res, gate)) return;

    const { idea, requirements, deliveryMode, replaceBacklog } = req.body ?? {};
    if (!idea?.trim()) return res.status(400).json({ error: 'idea is required' });

    const boxKey = await teamBoxKeyForTeam(orgCtx.orgId, teamId);
    const planResult = await applyJarvisWorkPlan({
      orgId: orgCtx.orgId,
      teamId,
      userId: orgCtx.userId ?? null,
      idea: idea.trim(),
      requirements: requirements?.trim(),
      deliveryMode: deliveryMode as DeliveryMode | undefined,
      teamBoxKey: boxKey,
      replaceBacklog: replaceBacklog === true,
    });

    await appendTeamEvent({
      supabase: supabaseAdmin!,
      orgId: orgCtx.orgId,
      teamId,
      eventType: 'jarvis.work_planned',
      actorType: 'SYSTEM',
      actorName: 'Jarvis',
      summary: planResult.plan.summary,
      jsonl: {
        deliveryMode: planResult.plan.deliveryMode,
        taskCount: planResult.tasks.length,
      },
    });

    res.status(201).json({
      plan: planResult.plan,
      tasks: planResult.tasks,
    });
  });

  app.get('/api/agent-studio/teams/:teamId/work-items', async (req, res) => {
    const orgCtx = await ctx.ensureContext(req, res);
    if (!orgCtx || ctx.dbDown(res)) return;
    const { teamId } = req.params;
    const { data, error } = await supabaseAdmin!
      .from('agent_studio_tasks')
      .select('*')
      .eq('team_id', teamId)
      .eq('org_id', orgCtx.orgId)
      .neq('status', 'DONE')
      .neq('status', 'CANCELLED')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });

    const items = (data ?? []).filter((t) => {
      const meta = (t.metadata ?? {}) as Record<string, unknown>;
      return meta.workItemKind || ['backlog', 'ready', 'intake'].includes(t.column_key as string);
    });
    res.json({ workItems: items });
  });

  app.post('/api/agent-studio/teams/:teamId/work-items', async (req, res) => {
    const orgCtx = await ctx.ensureContext(req, res);
    if (!orgCtx || !ctx.requireAnalyst(orgCtx, res) || ctx.dbDown(res)) return;
    const { teamId } = req.params;
    const gate = await readPauseGate({ orgId: orgCtx.orgId, teamId });
    if (ctx.blockedByPause(res, gate)) return;

    const { kind, title, description, parentTaskId, stories } = req.body ?? {};
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const workKind = (kind ?? 'TASK') as WorkItemKind;
    if (!['APP_IDEA', 'STORY', 'TASK'].includes(workKind)) {
      return res.status(400).json({ error: 'kind must be APP_IDEA, STORY, or TASK' });
    }

    const parent = await insertWorkItem({
      orgId: orgCtx.orgId,
      teamId,
      userId: orgCtx.userId ?? null,
      kind: workKind,
      title: title.trim(),
      description: description?.trim(),
      parentTaskId: parentTaskId ?? null,
    });

    const childTasks: Record<string, unknown>[] = [];
    if (workKind === 'APP_IDEA' && Array.isArray(stories)) {
      for (const s of stories) {
        if (!s?.title?.trim()) continue;
        const child = await insertWorkItem({
          orgId: orgCtx.orgId,
          teamId,
          userId: orgCtx.userId ?? null,
          kind: 'STORY',
          title: s.title.trim(),
          description: s.description?.trim(),
          parentTaskId: parent.id as string,
        });
        childTasks.push(child);
      }
    }

    res.status(201).json({ workItem: parent, stories: childTasks });
  });

  app.post('/api/agent-studio/teams/:teamId/start-working', async (req, res) => {
    const orgCtx = await ctx.ensureContext(req, res);
    if (!orgCtx || !ctx.requireAnalyst(orgCtx, res) || ctx.dbDown(res)) return;
    const { teamId } = req.params;
    const gate = await readPauseGate({ orgId: orgCtx.orgId, teamId });
    if (ctx.blockedByPause(res, gate)) return;

    const {
      objective: objectiveOverride,
      runMode,
      maxSteps,
      taskIds,
      useJarvis = true,
      name,
    } = req.body ?? {};

    let objective = objectiveOverride?.trim() ?? '';
    if (!objective) {
      objective = await buildTeamObjectiveFromBacklog({
        supabase: supabaseAdmin!,
        orgId: orgCtx.orgId,
        teamId,
        taskIds: Array.isArray(taskIds) ? taskIds : undefined,
      });
    }
    if (!objective) {
      const boxKey = await teamBoxKeyForTeam(orgCtx.orgId, teamId);
      const box = boxKey ? findTeamBox(boxKey) : null;
      objective = box?.exampleObjective ?? 'Advance all backlog work toward done with Jarvis coordinating the team.';
    }

    const run = await queueTeamRun({
      orgId: orgCtx.orgId,
      teamId,
      userId: orgCtx.userId ?? null,
      objective,
      runMode: runMode ?? 'RUN_UNTIL_BLOCKED',
      maxSteps: maxSteps ?? 50,
      useJarvis: useJarvis !== false,
      name: name ?? 'Start Working',
    });
    if (!run) {
      res.status(500).json({ error: 'Failed to queue team run' });
      return;
    }
    res.status(201).json({ run, objective });
  });
}

async function teamBoxKeyForTeam(orgId: string, teamId: string): Promise<string | null> {
  const { data } = await supabaseAdmin!
    .from('agent_studio_contexts')
    .select('data')
    .eq('org_id', orgId)
    .eq('team_id', teamId)
    .eq('key', 'team_box')
    .maybeSingle();
  const d = (data?.data ?? {}) as Record<string, unknown>;
  return typeof d.teamBoxKey === 'string' ? d.teamBoxKey : null;
}

async function applyJarvisWorkPlan(opts: {
  orgId: string;
  teamId: string;
  userId: string | null;
  idea: string;
  requirements?: string;
  deliveryMode?: DeliveryMode;
  teamBoxKey?: string | null;
  replaceBacklog?: boolean;
}): Promise<{ plan: ReturnType<typeof buildJarvisWorkPlan>; tasks: Record<string, unknown>[] }> {
  if (opts.replaceBacklog) {
    await supabaseAdmin!
      .from('agent_studio_tasks')
      .update({ status: 'CANCELLED' })
      .eq('team_id', opts.teamId)
      .eq('org_id', opts.orgId)
      .eq('column_key', 'backlog')
      .in('status', ['PLANNED', 'IN_PROGRESS']);
  }

  const plan = buildJarvisWorkPlan({
    idea: opts.idea,
    requirements: opts.requirements,
    deliveryMode: opts.deliveryMode,
    teamBox: opts.teamBoxKey ? findTeamBox(opts.teamBoxKey) : null,
  });

  const tasks: Record<string, unknown>[] = [];
  for (const item of plan.items) {
    const created = await insertPlannedItem({
      orgId: opts.orgId,
      teamId: opts.teamId,
      userId: opts.userId,
      item,
      parentTaskId: null,
    });
    tasks.push(...created);
  }
  return { plan, tasks };
}

async function insertPlannedItem(opts: {
  orgId: string;
  teamId: string;
  userId: string | null;
  item: PlannedWorkItem;
  parentTaskId: string | null;
}): Promise<Record<string, unknown>[]> {
  const kind: WorkItemKind =
    opts.item.kind === 'APP_IDEA'
      ? 'APP_IDEA'
      : opts.item.kind === 'STORY'
        ? 'STORY'
        : 'TASK';
  const row = await insertWorkItem({
    orgId: opts.orgId,
    teamId: opts.teamId,
    userId: opts.userId,
    kind: kind as WorkItemKind,
    title: opts.item.title,
    description: opts.item.description,
    parentTaskId: opts.parentTaskId,
    columnKey: opts.item.columnKey,
    taskType: opts.item.taskType,
    priority: opts.item.priority,
    plannedKind: opts.item.kind,
    progressEstimate: estimateProgressForPlannedItem(opts.item),
  });
  const out = [row];
  if (opts.item.children?.length) {
    for (const child of opts.item.children) {
      out.push(
        ...(await insertPlannedItem({
          orgId: opts.orgId,
          teamId: opts.teamId,
          userId: opts.userId,
          item: child,
          parentTaskId: row.id as string,
        }))
      );
    }
  }
  return out;
}

function estimateProgressForPlannedItem(item: PlannedWorkItem): number {
  if (item.columnKey === 'done') return 100;
  if (item.columnKey === 'in_progress') return 25;
  if (item.columnKey === 'ready') return 10;
  return 0;
}

async function insertWorkItem(opts: {
  orgId: string;
  teamId: string;
  userId: string | null;
  kind: WorkItemKind;
  title: string;
  description?: string;
  parentTaskId?: string | null;
  columnKey?: string;
  taskType?: string;
  priority?: string;
  plannedKind?: string;
  progressEstimate?: number;
}): Promise<Record<string, unknown>> {
  const { data: board } = await supabaseAdmin!
    .from('agent_studio_boards')
    .select('id')
    .eq('team_id', opts.teamId)
    .eq('org_id', opts.orgId)
    .eq('is_default', true)
    .maybeSingle();
  if (!board) throw new Error('Default board missing');

  const metadata: Record<string, unknown> = {
    workItemKind: opts.plannedKind ?? opts.kind,
    progressPercent: opts.progressEstimate ?? 0,
    progressNote: 'Estimated from board column; updates as the card moves.',
  };
  if (opts.parentTaskId) metadata.parentTaskId = opts.parentTaskId;

  const { data, error } = await supabaseAdmin!
    .from('agent_studio_tasks')
    .insert({
      org_id: opts.orgId,
      team_id: opts.teamId,
      board_id: board.id,
      column_key: opts.columnKey ?? 'backlog',
      title: opts.title,
      description: opts.description ?? null,
      task_type: opts.taskType ?? workItemTaskType(opts.kind),
      priority: opts.priority ?? (opts.kind === 'APP_IDEA' ? 'HIGH' : 'MEDIUM'),
      metadata,
      created_by: opts.userId,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  await logAgentStudioAudit({
    orgId: opts.orgId,
    teamId: opts.teamId,
    taskId: data.id as string,
    actorUserId: opts.userId,
    eventType: 'work_item.create',
    resourceType: 'agent_studio_tasks',
    resourceId: data.id as string,
    payload: { kind: opts.kind, title: opts.title },
  });

  return data as Record<string, unknown>;
}

async function queueTeamRun(opts: {
  orgId: string;
  teamId: string;
  userId: string | null;
  objective: string;
  runMode?: string;
  maxSteps?: number;
  useJarvis?: boolean;
  name?: string;
}): Promise<Record<string, unknown> | null> {
  let orchestratorAgentId: string | null = null;
  if (opts.useJarvis !== false) {
    orchestratorAgentId = await getJarvisAgentId(supabaseAdmin!, opts.orgId, opts.teamId);
  }

  const { data, error } = await supabaseAdmin!
    .from('agent_studio_team_runs')
    .insert({
      org_id: opts.orgId,
      team_id: opts.teamId,
      name: opts.name ?? 'Start Working',
      objective: opts.objective.trim(),
      run_mode: opts.runMode ?? 'RUN_UNTIL_BLOCKED',
      status: 'QUEUED',
      orchestrator_agent_id: orchestratorAgentId,
      max_steps: opts.maxSteps ?? 50,
      created_by: opts.userId,
      metadata: { executionMode: 'LOCAL_RUNNER_DEFAULT', source: 'start_working' },
    })
    .select('*')
    .single();
  if (error) {
    console.warn('[team-box] queue run failed', error.message);
    return null;
  }

  await appendTeamEvent({
    supabase: supabaseAdmin!,
    orgId: opts.orgId,
    teamId: opts.teamId,
    teamRunId: data.id as string,
    eventType: 'team_run.created',
    actorType: 'USER',
    actorName: 'user',
    summary: `Start Working: ${opts.objective.trim().slice(0, 120)}`,
    jsonl: { runId: data.id, source: 'start_working' },
  });

  return data as Record<string, unknown>;
}

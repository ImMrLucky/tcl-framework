/**
 * Persists TCL engine runs for Agent Studio and links them to agent runs.
 */

import { supabaseAdmin } from '../supabase.js';
import {
  buildArtifactFromAgentRun,
  runStudioTclAnalysis,
} from '../../studio/index.js';
import type { StudioTclReport, StudioTclTrigger, StudioWorkArtifact } from '../../studio/types.js';
import { createPatchProposalsFromTclReport } from './tcl-patch-proposals.js';
import { log } from '../utils/logger.js';
import { emitTclAnalysisEvent } from './tcl-sse-hub.js';

const TCL_MIGRATION_FILE = '054_agent_studio_tcl_analysis.sql';

export function isTclSchemaError(message: string): boolean {
  return (
    message.includes('agent_studio_tcl_analyses') ||
    message.includes('tcl_analysis_id') ||
    message.includes('does not exist')
  );
}

export async function createTclAnalysisRow(params: {
  orgId: string;
  teamId: string;
  trigger: StudioTclTrigger;
  inputSnapshot: StudioWorkArtifact;
  agentRunId?: string | null;
  teamRunId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
}): Promise<{ id: string } | { error: string }> {
  if (!supabaseAdmin) return { error: 'Database not configured' };

  const { data, error } = await supabaseAdmin
    .from('agent_studio_tcl_analyses')
    .insert({
      org_id: params.orgId,
      team_id: params.teamId,
      trigger: params.trigger,
      status: 'RUNNING',
      input_snapshot: params.inputSnapshot,
      agent_run_id: params.agentRunId ?? null,
      team_run_id: params.teamRunId ?? null,
      agent_id: params.agentId ?? null,
      task_id: params.taskId ?? null,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    if (isTclSchemaError(error.message)) {
      return { error: `Apply migration ${TCL_MIGRATION_FILE} on Supabase.` };
    }
    return { error: error.message };
  }
  return { id: data.id };
}

export async function finishTclAnalysisRow(
  analysisId: string,
  result: { report: StudioTclReport } | { error: string }
): Promise<void> {
  if (!supabaseAdmin) return;

  const patch =
    'report' in result
      ? {
          status: 'SUCCEEDED',
          report: result.report,
          finished_at: new Date().toISOString(),
        }
      : {
          status: 'FAILED',
          error: result.error,
          finished_at: new Date().toISOString(),
        };

  await supabaseAdmin.from('agent_studio_tcl_analyses').update(patch).eq('id', analysisId);
}

async function postProcessTclAnalysis(params: {
  orgId: string;
  teamId: string;
  analysisId: string;
  report: StudioTclReport;
  teamRunId?: string | null;
  agentRunId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
}): Promise<void> {
  emitTclAnalysisEvent(params.orgId, params.teamId, {
    id: params.analysisId,
    team_id: params.teamId,
    status: 'SUCCEEDED',
    report: params.report,
  });
  const patchResult = await createPatchProposalsFromTclReport({
    orgId: params.orgId,
    teamId: params.teamId,
    analysisId: params.analysisId,
    report: params.report,
    teamRunId: params.teamRunId,
    agentRunId: params.agentRunId,
    agentId: params.agentId,
    taskId: params.taskId,
  });
  if ('error' in patchResult && !patchResult.error.includes('migrations')) {
    log('warn', 'tcl-studio', 'patch proposal create failed', { error: patchResult.error });
  }
}

/** Fire-and-forget TCL after a Jarvis orchestration step (local runner). */
export function scheduleTclAnalysisForJarvisStep(params: {
  orgId: string;
  teamId: string;
  teamRunId: string;
  agentId: string;
  objective: string;
  jarvisOutput: string;
  actionSummary: string;
}): void {
  void runManualStudioTclAnalysis({
    orgId: params.orgId,
    teamId: params.teamId,
    artifact: {
      question: `Jarvis orchestration\nObjective: ${params.objective}\nAction: ${params.actionSummary}`,
      answer: params.jarvisOutput,
      teamId: params.teamId,
      agentId: params.agentId,
      teamRunId: params.teamRunId,
    },
    trigger: 'JARVIS_STEP',
    teamRunId: params.teamRunId,
    agentId: params.agentId,
  }).catch((err) => {
    log('warn', 'tcl-studio', 'Jarvis step analysis failed', {
      teamId: params.teamId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Fire-and-forget TCL after cloud IDE dispatch completes. */
export function scheduleTclAnalysisForDispatch(params: {
  orgId: string;
  teamId: string;
  agentId: string;
  taskId?: string | null;
  question: string;
  answer: string;
  sources?: Array<{ id: string; text: string; label?: string }>;
}): void {
  void runManualStudioTclAnalysis({
    orgId: params.orgId,
    teamId: params.teamId,
    artifact: {
      question: params.question,
      answer: params.answer,
      sources: params.sources,
      teamId: params.teamId,
      agentId: params.agentId,
      taskId: params.taskId ?? undefined,
    },
    trigger: 'IDE_DISPATCH',
    agentId: params.agentId,
    taskId: params.taskId ?? null,
  }).catch((err) => {
    log('warn', 'tcl-studio', 'IDE dispatch analysis failed', {
      teamId: params.teamId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Fire-and-forget TCL analysis after agent run completes. */
export function scheduleTclAnalysisForAgentRun(agentRun: {
  id: string;
  org_id: string;
  team_id: string;
  team_run_id?: string | null;
  agent_id: string;
  task_id?: string | null;
  use_case?: string | null;
  output?: string | null;
}): void {
  void runTclAnalysisForAgentRun(agentRun).catch((err) => {
    log('warn', 'tcl-studio', 'agent run analysis failed', {
      agentRunId: agentRun.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export async function runTclAnalysisForAgentRun(agentRun: {
  id: string;
  org_id: string;
  team_id: string;
  team_run_id?: string | null;
  agent_id: string;
  task_id?: string | null;
  use_case?: string | null;
  output?: string | null;
}): Promise<{ analysisId: string; report: StudioTclReport } | { error: string }> {
  if (!agentRun.output?.trim()) {
    return { error: 'No agent output to analyze' };
  }

  let taskTitle: string | null = null;
  let taskDescription: string | null = null;
  if (agentRun.task_id && supabaseAdmin) {
    const { data: task } = await supabaseAdmin
      .from('agent_studio_tasks')
      .select('title, description')
      .eq('id', agentRun.task_id)
      .maybeSingle();
    taskTitle = task?.title ?? null;
    taskDescription = task?.description ?? null;
  }

  let contextSources: Array<{ id: string; text: string; label?: string }> | undefined;
  if (supabaseAdmin) {
    const { data: summary } = await supabaseAdmin
      .from('agent_studio_team_context_summaries')
      .select('summary')
      .eq('team_id', agentRun.team_id)
      .maybeSingle();
    if (summary?.summary) {
      contextSources = [{ id: 'team-context', text: summary.summary, label: 'Team context' }];
    }
  }

  const artifact = buildArtifactFromAgentRun({
    taskTitle,
    taskDescription,
    useCase: agentRun.use_case,
    output: agentRun.output,
    contextSources,
    teamId: agentRun.team_id,
    agentId: agentRun.agent_id,
    taskId: agentRun.task_id,
    agentRunId: agentRun.id,
    teamRunId: agentRun.team_run_id,
  });

  const row = await createTclAnalysisRow({
    orgId: agentRun.org_id,
    teamId: agentRun.team_id,
    trigger: 'AGENT_RUN_COMPLETE',
    inputSnapshot: artifact,
    agentRunId: agentRun.id,
    teamRunId: agentRun.team_run_id,
    agentId: agentRun.agent_id,
    taskId: agentRun.task_id,
  });

  if ('error' in row) return row;

  try {
    const report = await runStudioTclAnalysis(artifact, {
      trigger: 'AGENT_RUN_COMPLETE',
      teamId: agentRun.team_id,
      agentRunId: agentRun.id,
      analysisId: row.id,
    });
    report.analysisId = row.id;
    await finishTclAnalysisRow(row.id, { report });

    if (supabaseAdmin) {
      await supabaseAdmin
        .from('agent_studio_agent_runs')
        .update({ tcl_analysis_id: row.id })
        .eq('id', agentRun.id);
    }

    return { analysisId: row.id, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishTclAnalysisRow(row.id, { error: msg });
    return { error: msg };
  }
}

export async function runManualStudioTclAnalysis(params: {
  orgId: string;
  teamId: string;
  artifact: StudioWorkArtifact;
  trigger?: StudioTclTrigger;
  agentRunId?: string | null;
  teamRunId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
}): Promise<{ analysisId: string; report: StudioTclReport } | { error: string }> {
  const trigger = params.trigger ?? 'MANUAL';
  const row = await createTclAnalysisRow({
    orgId: params.orgId,
    teamId: params.teamId,
    trigger,
    inputSnapshot: params.artifact,
    agentRunId: params.agentRunId,
    teamRunId: params.teamRunId,
    agentId: params.agentId,
    taskId: params.taskId,
  });
  if ('error' in row) return row;

  try {
    const report = await runStudioTclAnalysis(params.artifact, {
      trigger,
      teamId: params.teamId,
      agentRunId: params.agentRunId ?? undefined,
      analysisId: row.id,
    });
    report.analysisId = row.id;
    await finishTclAnalysisRow(row.id, { report });
    await postProcessTclAnalysis({
      orgId: params.orgId,
      teamId: params.teamId,
      analysisId: row.id,
      report,
      teamRunId: params.teamRunId,
      agentRunId: params.agentRunId,
      agentId: params.agentId,
      taskId: params.taskId,
    });
    return { analysisId: row.id, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishTclAnalysisRow(row.id, { error: msg });
    emitTclAnalysisEvent(params.orgId, params.teamId, {
      id: row.id,
      team_id: params.teamId,
      status: 'FAILED',
      error: msg,
    });
    return { error: msg };
  }
}

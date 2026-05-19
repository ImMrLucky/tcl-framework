import type { RunnerConfig } from './config.js';
import type { TeamRunJob } from './api-client.js';
import { previewRouting } from './api-client.js';
import { fetchBoardState } from './runner-api.js';
import { chatCompletion } from './model-client.js';
import { logTeamEvent } from './board-client.js';
import {
  executeJarvisAction,
  parseJarvisAction,
  type JarvisActionType,
} from './jarvis-actions.js';
import { scheduleJarvisTclStep } from './runner-api.js';

export type { JarvisActionType };

export interface JarvisTickResult {
  action: JarvisActionType;
  summary: string;
  done: boolean;
}

export async function runJarvisTick(
  config: RunnerConfig,
  run: TeamRunJob
): Promise<JarvisTickResult> {
  const teamId = run.team_id;
  const teamRunId = run.id;

  let eventLines = '(no events yet)';
  let boardHint = '';
  try {
    const [{ events }, board] = await Promise.all([
      import('./api-client.js').then((m) =>
        m.listTeamEvents(m.requireAuth(config), teamId, teamRunId, 50).catch(() => ({
          events: [],
        }))
      ),
      fetchBoardState(config, teamId).catch(() => null),
    ]);
    eventLines = (events ?? [])
      .slice(-25)
      .map((e) => `#${e.sequence} [${e.actor_type}] ${e.event_type}: ${e.summary}`)
      .join('\n');
    if (board?.tasks) {
      const unassigned = board.tasks.filter((t) => !t.assigned_agent_id && t.status !== 'DONE');
      boardHint = `Unassigned tasks: ${unassigned.length}. Agents: ${(board.agents ?? [])
        .map((a) => a.name)
        .join(', ')}`;
    }
  } catch {
    eventLines = '(partial context)';
  }

  let provider = config.defaultProvider ?? 'openai';
  let model = config.defaultModel ?? 'gpt-4o-mini';
  try {
    const route = await previewRouting(config, teamId, 'orchestrate', run.orchestrator_agent_id ?? undefined);
    provider = route.provider;
    model = route.model;
  } catch {
    /* local vault defaults */
  }

  const system = `You are Jarvis, the team orchestrator. LOCAL_RUNNER_DEFAULT: inference runs on the user's machine.
Respond with JSON only:
{ "type": "<JarvisActionType>", "summary": "<string>", "done": <boolean>, "taskId"?: "uuid", "agentId"?: "uuid", "columnKey"?: "string", "title"?: "string", "reason"?: "string" }

Allowed types: SUMMARIZE_STATUS, ASSIGN_TASK, MOVE_TASK, MARK_BLOCKED, UNBLOCK_TASK, REQUEST_REVIEW, CREATE_TASK, STOP_WAITING_FOR_HUMAN, STOP_RUN_COMPLETE.
Pick one safe next action. Never bypass pause or review gates.`;

  const user = `Team run ${teamRunId}
Objective: ${run.objective}
Steps ${run.completed_steps}/${run.max_steps} | Status ${run.status}
${boardHint}

Recent JSONL:
${eventLines}

What is the next action?`;

  const chat = await chatCompletion({
    provider,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  let parsed = parseJarvisAction(
    tryParseJson(chat.text) ?? { type: 'SUMMARIZE_STATUS', summary: chat.text.slice(0, 500) }
  );
  if (!parsed) {
    parsed = { type: 'SUMMARIZE_STATUS', summary: chat.text.slice(0, 500) };
  }

  const result = await executeJarvisAction({ config, run, action: parsed });
  let done = parsed.type === 'STOP_RUN_COMPLETE' || !!result.done;
  if (run.run_mode === 'ONE_STEP') done = true;
  if (run.completed_steps + 1 >= run.max_steps) done = true;

  if (!result.ok && result.error) {
    await logTeamEvent(config, teamId, {
      teamRunId,
      eventType: 'jarvis.action_failed',
      actorType: 'JARVIS',
      summary: result.summary,
      jsonl: { type: parsed.type, error: result.error },
    });
  }

  if (chat.text?.trim() && run.orchestrator_agent_id) {
    scheduleJarvisTclStep(config, {
      teamId,
      teamRunId,
      agentId: run.orchestrator_agent_id,
      objective: run.objective,
      jarvisOutput: chat.text,
      actionSummary: `${parsed.type}: ${result.summary}`,
    }).catch(() => {
      /* TCL optional */
    });
  }

  return {
    action: result.type,
    summary: result.summary,
    done,
  };
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

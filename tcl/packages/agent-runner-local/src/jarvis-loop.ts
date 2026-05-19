import type { RunnerConfig } from './config.js';
import type { TeamRunJob } from './api-client.js';
import { previewRouting } from './api-client.js';
import { fetchRecentEvents, logTeamEvent } from './board-client.js';
import { chatCompletion } from './model-client.js';
import { runAgentLoop, type AgentLoopInput } from './agent-loop.js';

export type JarvisActionType =
  | 'ASSIGN_TASK'
  | 'ASK_AGENT_STATUS'
  | 'START_AGENT_TASK'
  | 'CREATE_REVIEW_GATE'
  | 'REQUEST_HUMAN_REVIEW'
  | 'MOVE_TASK'
  | 'SUMMARIZE_PROGRESS'
  | 'STOP_WAITING_FOR_HUMAN'
  | 'STOP_RUN_COMPLETE';

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
  try {
    const { events } = await fetchRecentEvents(config, teamId, teamRunId, 100);
    eventLines = events
      .slice(-30)
      .map((e) => `#${e.sequence} [${e.actor_type}] ${e.event_type}: ${e.summary}`)
      .join('\n');
  } catch {
    eventLines = '(events unavailable — run `agent-runner-local login` to sync)';
  }

  let provider = config.defaultProvider ?? 'openai';
  let model = config.defaultModel ?? 'gpt-4o-mini';
  try {
    const route = await previewRouting(config, teamId, 'orchestrate', run.orchestrator_agent_id ?? undefined);
    provider = route.provider;
    model = route.model;
  } catch {
    /* use defaults */
  }

  const system = `You are Jarvis, the team orchestrator for Agent Studio.
Respond with JSON only: { "action": "<JarvisActionType>", "summary": "<one paragraph>", "done": <boolean> }
Actions: SUMMARIZE_PROGRESS, REQUEST_HUMAN_REVIEW, STOP_RUN_COMPLETE, ASSIGN_TASK, START_AGENT_TASK.
Rules: never bypass pause or review gates; prefer small safe steps; if blocked, set done false and action REQUEST_HUMAN_REVIEW.`;

  const user = `Team run ${teamRunId}
Objective: ${run.objective}
Status: ${run.status} | Steps ${run.completed_steps}/${run.max_steps} | Mode ${run.run_mode}

Recent shared JSONL events:
${eventLines}

What is the next orchestration action?`;

  const chat = await chatCompletion({
    provider,
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  let action: JarvisActionType = 'SUMMARIZE_PROGRESS';
  let done = false;
  let summary = chat.text.slice(0, 2000);

  try {
    const parsed = JSON.parse(chat.text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()) as {
      action?: JarvisActionType;
      summary?: string;
      done?: boolean;
    };
    if (parsed.action) action = parsed.action;
    if (parsed.summary) summary = parsed.summary;
    if (typeof parsed.done === 'boolean') done = parsed.done;
  } catch {
    summary = chat.text.slice(0, 500);
  }

  await logTeamEvent(config, teamId, {
    teamRunId,
    agentId: run.orchestrator_agent_id ?? undefined,
    eventType: 'jarvis.tick',
    actorType: 'JARVIS',
    actorName: 'Jarvis',
    summary,
    jsonl: { action, provider, model, done },
  });

  if (action === 'START_AGENT_TASK' && run.orchestrator_agent_id) {
    const agentInput: AgentLoopInput = {
      teamId,
      agentId: run.orchestrator_agent_id,
      userPrompt: `Execute one step toward: ${run.objective}`,
      useCase: 'code',
    };
    const agentResult = await runAgentLoop(config, agentInput, { provider, model });
    await logTeamEvent(config, teamId, {
      teamRunId,
      agentId: run.orchestrator_agent_id,
      eventType: 'agent.tick',
      actorType: 'AGENT',
      summary: agentResult.summary,
      jsonl: { status: agentResult.status },
    });
    if (agentResult.status === 'NEEDS_HUMAN') done = false;
  }

  if (run.completed_steps + 1 >= run.max_steps) {
    done = true;
    action = 'STOP_RUN_COMPLETE';
  }

  if (run.run_mode === 'ONE_STEP') {
    done = true;
  }

  return { action, summary, done };
}

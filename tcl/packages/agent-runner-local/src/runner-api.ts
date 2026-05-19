/**
 * Runner-authenticated ProtectQA API client (execution plane).
 */

import type { RunnerConfig } from './config.js';
import { ApiError } from './api-client.js';

function baseUrl(config: RunnerConfig): string {
  return config.apiBaseUrl.replace(/\/$/, '');
}

export function runnerHeaders(config: RunnerConfig): Record<string, string> {
  const token = config.runnerAuthToken;
  if (!token || !config.runnerId) {
    throw new Error('Runner not paired — run `agent-runner-local pair` and save runnerAuthToken.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-ProtectQA-Runner-Id': config.runnerId,
  };
}

async function runnerRequest<T>(
  config: RunnerConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${baseUrl(config)}${path}`, {
    method,
    headers: runnerHeaders(config),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err =
      typeof json === 'object' && json && 'error' in json
        ? String((json as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(err || `HTTP ${res.status}`, res.status, json);
  }
  return json as T;
}

export interface BoardTask {
  id: string;
  title: string;
  status: string;
  column_key: string;
  assigned_agent_id: string | null;
}

export async function fetchBoardState(config: RunnerConfig, teamId: string) {
  return runnerRequest<{
    team: unknown;
    board: unknown;
    columns: unknown[];
    tasks: BoardTask[];
    agents: Array<{ id: string; name: string; is_orchestrator?: boolean; status?: string }>;
    reviewGatesByTaskId: Record<string, unknown[]>;
    pauseState: unknown;
  }>(config, 'GET', `/api/agent-studio/local-runner/teams/${teamId}/board-state`);
}

export async function assignTask(config: RunnerConfig, taskId: string, agentId: string) {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/tasks/${taskId}/assign`, {
    agentId,
  });
}

export async function moveTask(config: RunnerConfig, taskId: string, columnKey: string) {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/tasks/${taskId}/move`, {
    columnKey,
  });
}

export async function blockTask(config: RunnerConfig, taskId: string, reason?: string) {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/tasks/${taskId}/block`, {
    reason,
  });
}

export async function unblockTask(config: RunnerConfig, taskId: string) {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/tasks/${taskId}/unblock`, {});
}

export async function requestReview(
  config: RunnerConfig,
  taskId: string,
  gateType: string,
  columnKey?: string
) {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/tasks/${taskId}/review-request`, {
    gateType,
    columnKey,
  });
}

export async function createTask(
  config: RunnerConfig,
  body: {
    teamId: string;
    title: string;
    description?: string;
    columnKey?: string;
    taskType?: string;
  }
) {
  return runnerRequest<{ task: { id: string; title: string } }>(
    config,
    'POST',
    '/api/agent-studio/local-runner/tasks',
    body
  );
}

export async function appendTeamEvent(
  config: RunnerConfig,
  teamId: string,
  body: {
    teamRunId?: string;
    agentId?: string;
    taskId?: string;
    eventType: string;
    actorType: string;
    actorName?: string;
    summary: string;
    jsonl?: Record<string, unknown>;
  }
): Promise<void> {
  await runnerRequest(config, 'POST', `/api/agent-studio/local-runner/teams/${teamId}/events`, body);
}

export async function createAgentRun(
  config: RunnerConfig,
  body: Record<string, unknown>
): Promise<{ agentRun: { id: string } }> {
  return runnerRequest(config, 'POST', '/api/agent-studio/local-runner/agent-runs', body);
}

export async function updateAgentRun(
  config: RunnerConfig,
  agentRunId: string,
  body: Record<string, unknown>
) {
  return runnerRequest(config, 'PATCH', `/api/agent-studio/local-runner/agent-runs/${agentRunId}`, body);
}

export async function createAgentRunStep(
  config: RunnerConfig,
  agentRunId: string,
  body: Record<string, unknown>
) {
  return runnerRequest(
    config,
    'POST',
    `/api/agent-studio/local-runner/agent-runs/${agentRunId}/steps`,
    body
  );
}

export async function updateAgentRunStep(
  config: RunnerConfig,
  stepId: string,
  body: Record<string, unknown>
) {
  return runnerRequest(
    config,
    'PATCH',
    `/api/agent-studio/local-runner/agent-run-steps/${stepId}`,
    body
  );
}

export async function getPrivateContext(config: RunnerConfig, agentId: string) {
  return runnerRequest<{ context: Record<string, unknown> | null }>(
    config,
    'GET',
    `/api/agent-studio/local-runner/agents/${agentId}/private-context`
  );
}

export async function patchPrivateContext(
  config: RunnerConfig,
  agentId: string,
  body: Record<string, unknown>
) {
  return runnerRequest(
    config,
    'PATCH',
    `/api/agent-studio/local-runner/agents/${agentId}/private-context`,
    body
  );
}

/** Schedule TCL analysis for a Jarvis orchestration step (202, fire-and-forget). */
export async function scheduleJarvisTclStep(
  config: RunnerConfig,
  body: {
    teamId: string;
    teamRunId: string;
    agentId: string;
    objective: string;
    jarvisOutput: string;
    actionSummary: string;
  }
) {
  return runnerRequest<{ scheduled: boolean }>(
    config,
    'POST',
    '/api/agent-studio/local-runner/tcl/jarvis-step',
    body
  );
}

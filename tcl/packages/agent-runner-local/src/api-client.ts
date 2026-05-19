import type { RunnerConfig } from './config.js';
import { loadConfig } from './config.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function baseUrl(config: RunnerConfig): string {
  return config.apiBaseUrl.replace(/\/$/, '');
}

function headers(config: RunnerConfig, withAuth = false): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = config.authToken ?? process.env['PROTECTQA_AUTH_TOKEN'];
  if (withAuth && token) {
    h['Authorization'] = `Bearer ${token}`;
  }
  return h;
}

export function runnerHeaders(config: RunnerConfig): Record<string, string> {
  const token = config.runnerAuthToken;
  if (!token || !config.runnerId) {
    throw new Error('Runner auth missing — run `agent-runner-local pair` first.');
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

async function request<T>(
  config: RunnerConfig,
  method: string,
  path: string,
  body?: unknown,
  withAuth = false
): Promise<T> {
  const res = await fetch(`${baseUrl(config)}${path}`, {
    method,
    headers: headers(config, withAuth),
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

export interface TeamRunJob {
  id: string;
  team_id: string;
  org_id: string;
  objective: string;
  status: string;
  run_mode: string;
  max_steps: number;
  completed_steps: number;
  orchestrator_agent_id: string | null;
  local_runner_id?: string | null;
}

export interface TeamEventRow {
  sequence: number;
  event_type: string;
  actor_type: string;
  summary: string;
  jsonl: Record<string, unknown>;
  created_at: string;
}

export async function pairRunner(
  config: RunnerConfig,
  pairingCode: string,
  deviceLabel?: string
): Promise<{
  runner: { id: string; name: string; status: string };
  runnerAuthToken: string;
}> {
  return request(config, 'POST', '/api/agent-studio/local-runners/pair', {
    pairingCode: pairingCode.trim().toUpperCase(),
    deviceLabel,
    runnerPublicKey: config.runnerPublicKey ?? null,
  });
}

export async function heartbeatRunner(
  config: RunnerConfig,
  capabilities?: Record<string, unknown>
): Promise<void> {
  await runnerRequest(config, 'POST', `/api/agent-studio/local-runners/${config.runnerId}/heartbeat`, {
    capabilities: capabilities ?? { version: '0.1.0' },
  });
}

export async function pollJobs(config: RunnerConfig): Promise<{
  jobs: TeamRunJob[];
  revoked?: boolean;
}> {
  return runnerRequest(config, 'GET', '/api/agent-studio/local-runner/jobs/poll');
}

export async function claimJob(
  config: RunnerConfig,
  jobId: string,
  sessionId: string
): Promise<{ run: TeamRunJob }> {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/jobs/${jobId}/claim`, {
    sessionId,
  });
}

export async function progressJob(
  config: RunnerConfig,
  jobId: string,
  patch: { completedSteps?: number; status?: string; metadata?: Record<string, unknown> }
): Promise<{ run: TeamRunJob }> {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/jobs/${jobId}/progress`, patch);
}

export async function completeJob(
  config: RunnerConfig,
  jobId: string,
  status?: string,
  metadata?: Record<string, unknown>
): Promise<{ run: TeamRunJob }> {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/jobs/${jobId}/complete`, {
    status,
    metadata,
  });
}

export async function failJob(
  config: RunnerConfig,
  jobId: string,
  error: string,
  metadata?: Record<string, unknown>
): Promise<{ run: TeamRunJob }> {
  return runnerRequest(config, 'POST', `/api/agent-studio/local-runner/jobs/${jobId}/fail`, {
    error,
    metadata,
  });
}

export async function listTeamEvents(
  config: RunnerConfig,
  teamId: string,
  teamRunId?: string,
  limit = 100
): Promise<{ events: TeamEventRow[] }> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (teamRunId) q.set('teamRunId', teamRunId);
  return request(
    config,
    'GET',
    `/api/agent-studio/teams/${teamId}/events?${q}`,
    undefined,
    true
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
  await request(config, 'POST', `/api/agent-studio/teams/${teamId}/events`, body, true);
}

export async function registerLocalVendor(
  config: RunnerConfig,
  body: {
    localRunnerId: string;
    provider: string;
    label: string;
    localKeyRef: string;
    keyPreview?: string;
    supportedModels?: string[];
  }
): Promise<void> {
  await request(config, 'POST', '/api/agent-studio/local-vendors/register', body, true);
}

export async function previewRouting(
  config: RunnerConfig,
  teamId: string,
  useCase: string,
  agentId?: string
): Promise<{ provider: string; model: string; keyMode: string }> {
  return request(
    config,
    'POST',
    '/api/agent-studio/model-routing/preview',
    { teamId, useCase, agentId, executionMode: 'LOCAL_RUNNER_DEFAULT' },
    true
  );
}

export function requireAuth(config: RunnerConfig): RunnerConfig {
  const token = config.authToken ?? process.env['PROTECTQA_AUTH_TOKEN'];
  if (!token) {
    throw new Error(
      'Auth token required. Run `agent-runner-local login` or set PROTECTQA_AUTH_TOKEN (Supabase session access_token).'
    );
  }
  return { ...config, authToken: token };
}

export async function loadApiConfig(): Promise<RunnerConfig> {
  return loadConfig();
}

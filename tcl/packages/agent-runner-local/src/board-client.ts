import type { RunnerConfig } from './config.js';
import { appendTeamEvent, listTeamEvents, requireAuth } from './api-client.js';
import { appendLocalJsonlEvent } from './jsonl-log.js';

export async function fetchRecentEvents(
  config: RunnerConfig,
  teamId: string,
  teamRunId?: string,
  limit = 100
) {
  const authed = requireAuth(config);
  return listTeamEvents(authed, teamId, teamRunId, limit);
}

export async function logTeamEvent(
  config: RunnerConfig,
  teamId: string,
  event: {
    teamRunId?: string;
    agentId?: string;
    eventType: string;
    actorType: string;
    actorName?: string;
    summary: string;
    jsonl?: Record<string, unknown>;
  }
): Promise<void> {
  appendLocalJsonlEvent(teamId, {
    eventType: event.eventType,
    actorType: event.actorType,
    summary: event.summary,
    ...event.jsonl,
  });
  try {
    const authed = requireAuth(config);
    await appendTeamEvent(authed, teamId, event);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[runner] Could not sync event to ProtectQA (login required):', msg);
  }
}

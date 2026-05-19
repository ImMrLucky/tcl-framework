/**
 * Deterministic Jarvis action executor — model suggests, this layer applies.
 */

import type { RunnerConfig } from './config.js';
import type { TeamRunJob } from './api-client.js';
import {
  appendTeamEvent,
  assignTask,
  blockTask,
  createTask,
  fetchBoardState,
  moveTask,
  requestReview,
  unblockTask,
} from './runner-api.js';

export type JarvisActionType =
  | 'SUMMARIZE_STATUS'
  | 'ASSIGN_TASK'
  | 'CREATE_TASK'
  | 'START_AGENT_TASK'
  | 'ASK_AGENT_STATUS'
  | 'MOVE_TASK'
  | 'MARK_BLOCKED'
  | 'UNBLOCK_TASK'
  | 'CREATE_REVIEW_GATE'
  | 'REQUEST_REVIEW'
  | 'UPDATE_SHARED_CONTEXT'
  | 'STOP_WAITING_FOR_HUMAN'
  | 'STOP_WAITING_FOR_REVIEW'
  | 'STOP_RUN_COMPLETE';

export interface JarvisAction {
  type: JarvisActionType;
  taskId?: string;
  agentId?: string;
  columnKey?: string;
  title?: string;
  description?: string;
  reason?: string;
  summary?: string;
}

export interface JarvisActionResult {
  ok: boolean;
  type: JarvisActionType;
  summary: string;
  done?: boolean;
  error?: string;
}

const ALLOWED: Set<JarvisActionType> = new Set([
  'SUMMARIZE_STATUS',
  'ASSIGN_TASK',
  'CREATE_TASK',
  'START_AGENT_TASK',
  'ASK_AGENT_STATUS',
  'MOVE_TASK',
  'MARK_BLOCKED',
  'UNBLOCK_TASK',
  'CREATE_REVIEW_GATE',
  'REQUEST_REVIEW',
  'UPDATE_SHARED_CONTEXT',
  'STOP_WAITING_FOR_HUMAN',
  'STOP_WAITING_FOR_REVIEW',
  'STOP_RUN_COMPLETE',
]);

export function parseJarvisAction(raw: unknown): JarvisAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const type = o['type'] ?? o['action'];
  if (typeof type !== 'string' || !ALLOWED.has(type as JarvisActionType)) return null;
  return {
    type: type as JarvisActionType,
    taskId: typeof o['taskId'] === 'string' ? o['taskId'] : undefined,
    agentId: typeof o['agentId'] === 'string' ? o['agentId'] : undefined,
    columnKey: typeof o['columnKey'] === 'string' ? o['columnKey'] : undefined,
    title: typeof o['title'] === 'string' ? o['title'] : undefined,
    description: typeof o['description'] === 'string' ? o['description'] : undefined,
    reason: typeof o['reason'] === 'string' ? o['reason'] : undefined,
    summary: typeof o['summary'] === 'string' ? o['summary'] : undefined,
  };
}

export async function executeJarvisAction(input: {
  config: RunnerConfig;
  run: TeamRunJob;
  action: JarvisAction;
}): Promise<JarvisActionResult> {
  const { config, run, action } = input;
  const teamId = run.team_id;
  const teamRunId = run.id;

  if (!ALLOWED.has(action.type)) {
    return { ok: false, type: action.type, summary: 'Unknown action', error: 'INVALID_ACTION' };
  }

  try {
    switch (action.type) {
      case 'SUMMARIZE_STATUS': {
        const board = await fetchBoardState(config, teamId);
        const open = (board.tasks ?? []).filter(
          (t) => t.status !== 'DONE' && t.status !== 'CANCELLED'
        );
        const summary =
          action.summary ??
          `Team has ${open.length} open task(s); ${board.agents?.length ?? 0} agents.`;
        await appendTeamEvent(config, teamId, {
          teamRunId,
          eventType: 'jarvis.summarize',
          actorType: 'JARVIS',
          actorName: 'Jarvis',
          summary,
        });
        return { ok: true, type: action.type, summary, done: false };
      }

      case 'ASSIGN_TASK': {
        if (!action.taskId || !action.agentId) {
          return {
            ok: false,
            type: action.type,
            summary: 'taskId and agentId required',
            error: 'MISSING_FIELDS',
          };
        }
        await assignTask(config, action.taskId, action.agentId);
        const summary = action.summary ?? `Assigned task to agent ${action.agentId}`;
        await appendTeamEvent(config, teamId, {
          teamRunId,
          taskId: action.taskId,
          agentId: action.agentId,
          eventType: 'jarvis.assign_task',
          actorType: 'JARVIS',
          summary,
          jsonl: { taskId: action.taskId, agentId: action.agentId },
        });
        return { ok: true, type: action.type, summary };
      }

      case 'MOVE_TASK': {
        if (!action.taskId || !action.columnKey) {
          return {
            ok: false,
            type: action.type,
            summary: 'taskId and columnKey required',
            error: 'MISSING_FIELDS',
          };
        }
        await moveTask(config, action.taskId, action.columnKey);
        const summary =
          action.summary ?? `Moved task to column ${action.columnKey}`;
        await appendTeamEvent(config, teamId, {
          teamRunId,
          taskId: action.taskId,
          eventType: 'jarvis.move_task',
          actorType: 'JARVIS',
          summary,
          jsonl: { columnKey: action.columnKey },
        });
        return { ok: true, type: action.type, summary };
      }

      case 'MARK_BLOCKED': {
        if (!action.taskId) {
          return { ok: false, type: action.type, summary: 'taskId required', error: 'MISSING_FIELDS' };
        }
        await blockTask(config, action.taskId, action.reason);
        const summary = action.summary ?? `Blocked task: ${action.reason ?? 'blocked'}`;
        await appendTeamEvent(config, teamId, {
          teamRunId,
          taskId: action.taskId,
          eventType: 'jarvis.block_task',
          actorType: 'JARVIS',
          summary,
        });
        return { ok: true, type: action.type, summary };
      }

      case 'UNBLOCK_TASK': {
        if (!action.taskId) {
          return { ok: false, type: action.type, summary: 'taskId required', error: 'MISSING_FIELDS' };
        }
        await unblockTask(config, action.taskId);
        const summary = action.summary ?? 'Unblocked task';
        await appendTeamEvent(config, teamId, {
          teamRunId,
          taskId: action.taskId,
          eventType: 'jarvis.unblock_task',
          actorType: 'JARVIS',
          summary,
        });
        return { ok: true, type: action.type, summary };
      }

      case 'REQUEST_REVIEW':
      case 'CREATE_REVIEW_GATE': {
        if (!action.taskId) {
          return { ok: false, type: action.type, summary: 'taskId required', error: 'MISSING_FIELDS' };
        }
        await requestReview(config, action.taskId, 'CODE_REVIEW', action.columnKey ?? 'review');
        const summary = action.summary ?? 'Review requested';
        await appendTeamEvent(config, teamId, {
          teamRunId,
          taskId: action.taskId,
          eventType: 'jarvis.request_review',
          actorType: 'JARVIS',
          summary,
        });
        return { ok: true, type: action.type, summary };
      }

      case 'CREATE_TASK': {
        if (!action.title) {
          return { ok: false, type: action.type, summary: 'title required', error: 'MISSING_FIELDS' };
        }
        const { task } = await createTask(config, {
          teamId,
          title: action.title,
          description: action.description,
          columnKey: action.columnKey ?? 'backlog',
        });
        const summary = action.summary ?? `Created task: ${action.title}`;
        await appendTeamEvent(config, teamId, {
          teamRunId,
          taskId: task.id,
          eventType: 'jarvis.create_task',
          actorType: 'JARVIS',
          summary,
        });
        return { ok: true, type: action.type, summary };
      }

      case 'STOP_WAITING_FOR_HUMAN':
      case 'STOP_WAITING_FOR_REVIEW':
      case 'STOP_RUN_COMPLETE': {
        const summary = action.summary ?? `Jarvis: ${action.type}`;
        await appendTeamEvent(config, teamId, {
          teamRunId,
          eventType: `jarvis.${action.type.toLowerCase()}`,
          actorType: 'JARVIS',
          summary,
        });
        return {
          ok: true,
          type: action.type,
          summary,
          done: action.type === 'STOP_RUN_COMPLETE',
        };
      }

      default:
        return {
          ok: false,
          type: action.type,
          summary: `Action ${action.type} not implemented in executor yet`,
          error: 'NOT_IMPLEMENTED',
        };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, type: action.type, summary: msg, error: msg };
  }
}

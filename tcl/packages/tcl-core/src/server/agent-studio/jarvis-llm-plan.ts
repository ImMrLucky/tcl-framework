/**
 * LLM-backed Jarvis work breakdown (uses orchestrator agent routing + BYOK).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { completeWithAgentRouting } from './llm-completion.js';
import type { DeliveryMode, JarvisWorkPlan, PlannedWorkItem } from './team-intake.js';
import { buildJarvisWorkPlan } from './team-intake.js';

function tryParseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(trimmed);
}

function normalizePlannedItem(
  raw: Record<string, unknown>,
  fallbackKind: PlannedWorkItem['kind']
): PlannedWorkItem | null {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return null;
  const kindRaw = typeof raw.kind === 'string' ? raw.kind.toUpperCase() : fallbackKind;
  const kind = (['APP_IDEA', 'SPEC', 'STORY', 'TASK'].includes(kindRaw)
    ? kindRaw
    : fallbackKind) as PlannedWorkItem['kind'];
  const taskTypeRaw = typeof raw.taskType === 'string' ? raw.taskType.toUpperCase() : 'STORY';
  const taskType = (['SPEC', 'STORY', 'CHORE', 'RESEARCH', 'SPIKE'].includes(taskTypeRaw)
    ? taskTypeRaw
    : 'STORY') as PlannedWorkItem['taskType'];
  const priorityRaw = typeof raw.priority === 'string' ? raw.priority.toUpperCase() : 'MEDIUM';
  const priority = (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(priorityRaw)
    ? priorityRaw
    : 'MEDIUM') as PlannedWorkItem['priority'];
  const childrenRaw = Array.isArray(raw.children) ? raw.children : [];
  const children: PlannedWorkItem[] = [];
  for (const c of childrenRaw) {
    if (c && typeof c === 'object') {
      const child = normalizePlannedItem(c as Record<string, unknown>, kind === 'APP_IDEA' ? 'STORY' : 'TASK');
      if (child) children.push(child);
    }
  }
  return {
    kind,
    title: title.slice(0, 200),
    description: typeof raw.description === 'string' ? raw.description : undefined,
    taskType,
    columnKey: typeof raw.columnKey === 'string' ? raw.columnKey : 'backlog',
    priority,
    children: children.length ? children : undefined,
  };
}

export async function llmJarvisWorkPlan(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  jarvisAgentId: string;
  idea: string;
  requirements?: string;
  deliveryMode?: DeliveryMode;
}): Promise<JarvisWorkPlan | null> {
  const detail = opts.requirements?.trim() || opts.idea.trim();
  const system = `You are Jarvis, a team orchestrator. Break the user's initiative into a structured delivery plan for a kanban board.
Return JSON only:
{
  "deliveryMode": "SPEC_DRIVEN" | "TASK_DRIVEN",
  "summary": "one sentence",
  "items": [
    {
      "kind": "APP_IDEA" | "SPEC" | "STORY" | "TASK",
      "title": "string",
      "description": "string",
      "taskType": "SPEC" | "STORY" | "CHORE" | "RESEARCH" | "SPIKE",
      "columnKey": "backlog",
      "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      "children": [ /* same shape, optional nested */ ]
    }
  ]
}
Use APP_IDEA as root when appropriate with child SPEC/STORY items. Be specific to the user's idea — not generic placeholders.`;

  const user = `Initiative:\n${opts.idea.trim()}\n\nRequirements:\n${detail}`;

  const { text } = await completeWithAgentRouting({
    supabase: opts.supabase,
    orgId: opts.orgId,
    teamId: opts.teamId,
    agentId: opts.jarvisAgentId,
    useCase: 'plan',
    system,
    user,
  });

  const parsed = tryParseJson(text) as Record<string, unknown>;
  const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
  const items: PlannedWorkItem[] = [];
  for (const row of itemsRaw) {
    if (row && typeof row === 'object') {
      const item = normalizePlannedItem(row as Record<string, unknown>, 'APP_IDEA');
      if (item) items.push(item);
    }
  }
  if (!items.length) return null;

  const deliveryMode =
    parsed.deliveryMode === 'TASK_DRIVEN' || parsed.deliveryMode === 'SPEC_DRIVEN'
      ? parsed.deliveryMode
      : opts.deliveryMode ?? 'SPEC_DRIVEN';

  return {
    deliveryMode,
    complexityScore: 0,
    complexityLabel: 'moderate',
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : `Jarvis (LLM) planned ${items.length} top-level work item(s).`,
    items,
  };
}

export async function buildJarvisWorkPlanWithLlm(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  jarvisAgentId: string | null;
  idea: string;
  requirements?: string;
  deliveryMode?: DeliveryMode;
  teamBoxKey?: string | null;
}): Promise<JarvisWorkPlan> {
  if (opts.jarvisAgentId) {
    try {
      const llm = await llmJarvisWorkPlan({
        supabase: opts.supabase,
        orgId: opts.orgId,
        teamId: opts.teamId,
        jarvisAgentId: opts.jarvisAgentId,
        idea: opts.idea,
        requirements: opts.requirements,
        deliveryMode: opts.deliveryMode,
      });
      if (llm?.items?.length) return llm;
    } catch (e) {
      console.warn('[jarvis-plan] LLM plan failed, using templates:', e);
    }
  }

  const { findTeamBox } = await import('./team-box.js');
  return buildJarvisWorkPlan({
    idea: opts.idea,
    requirements: opts.requirements,
    deliveryMode: opts.deliveryMode,
    teamBox: opts.teamBoxKey ? findTeamBox(opts.teamBoxKey) : null,
  });
}

/**
 * Brainstorm → team recommendation + Jarvis work breakdown (heuristic MVP).
 * LLM refinement can run later via local runner / dispatch.
 */

import { TEAM_BOX_CATALOG, findTeamBox, type TeamBoxDefinition } from './team-box.js';

export type DeliveryMode = 'SPEC_DRIVEN' | 'TASK_DRIVEN';

export interface TeamBoxRecommendation {
  teamBoxKey: string;
  teamBoxName: string;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  suggestedTeamName: string;
  deliveryMode: DeliveryMode;
  complexityScore: number;
  complexityLabel: 'simple' | 'moderate' | 'complex';
}

export interface PlannedWorkItem {
  kind: 'APP_IDEA' | 'SPEC' | 'STORY' | 'TASK';
  title: string;
  description?: string;
  taskType: 'SPEC' | 'STORY' | 'CHORE' | 'RESEARCH' | 'SPIKE';
  columnKey: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Child items when parent is APP_IDEA or SPEC */
  children?: PlannedWorkItem[];
}

export interface JarvisWorkPlan {
  deliveryMode: DeliveryMode;
  complexityScore: number;
  complexityLabel: 'simple' | 'moderate' | 'complex';
  summary: string;
  items: PlannedWorkItem[];
}

const MOBILE_HINTS = [
  'mobile',
  'ios',
  'android',
  'iphone',
  'ipad',
  'react native',
  'flutter',
  'swift',
  'kotlin',
  'app store',
  'play store',
];
const WEB_HINTS = [
  'web',
  'website',
  'dashboard',
  'portal',
  'saas',
  'frontend',
  'backend',
  'react',
  'angular',
  'vue',
  'next.js',
  'browser',
];
const AI_HINTS = [
  'ai',
  'ml',
  'machine learning',
  'llm',
  'gpt',
  'model',
  'inference',
  'rag',
  'embedding',
  'neural',
  'data science',
  'fine-tun',
];
const GAME_HINTS = [
  'game',
  'gaming',
  'roblox',
  'lua',
  'luau',
  'unity',
  'godot',
  'unreal',
  'gamedev',
  'game dev',
  'multiplayer',
  'level design',
  'gameplay',
  'npc',
  'quest',
  'mmo',
  'fps',
  'platformer',
  'rpg',
  'simulator',
  'obby',
  'tycoon',
  'studio',
  'xbox',
  'playstation',
  'steam',
  'itch.io',
];

const COMPLEX_HINTS = [
  'enterprise',
  'platform',
  'multi-tenant',
  'compliance',
  'hipaa',
  'soc2',
  'integration',
  'microservice',
  'distributed',
  'multiple teams',
  'full product',
  'marketplace',
  'payment',
  'auth',
  'real-time',
];
const SIMPLE_HINTS = [
  'small',
  'simple',
  'quick',
  'fix',
  'bug',
  'button',
  'landing page',
  'prototype',
  'spike',
  'poc',
  'mvp only',
];

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

function scoreHints(text: string, hints: string[]): number {
  const n = norm(text);
  let s = 0;
  for (const h of hints) {
    if (n.includes(h)) s += h.length > 6 ? 2 : 1;
  }
  return s;
}

export function assessComplexity(idea: string, requirements?: string): {
  score: number;
  label: 'simple' | 'moderate' | 'complex';
  deliveryMode: DeliveryMode;
} {
  const combined = `${idea}\n${requirements ?? ''}`.trim();
  const words = combined.split(/\s+/).filter(Boolean).length;
  let score = Math.min(10, Math.floor(words / 40));
  score += scoreHints(combined, COMPLEX_HINTS);
  score -= Math.min(3, scoreHints(combined, SIMPLE_HINTS));
  if (words > 120) score += 1;
  if (words > 250) score += 1;
  score = Math.max(0, Math.min(10, score));

  const label: 'simple' | 'moderate' | 'complex' =
    score <= 2 ? 'simple' : score <= 5 ? 'moderate' : 'complex';
  const deliveryMode: DeliveryMode = label === 'simple' ? 'TASK_DRIVEN' : 'SPEC_DRIVEN';
  return { score, label, deliveryMode };
}

export function recommendTeamBox(idea: string, requirements?: string): TeamBoxRecommendation {
  const combined = `${idea}\n${requirements ?? ''}`;
  const mobile = scoreHints(combined, MOBILE_HINTS);
  const web = scoreHints(combined, WEB_HINTS);
  const ai = scoreHints(combined, AI_HINTS);
  const game = scoreHints(combined, GAME_HINTS);

  let teamBoxKey = 'web_app';
  let confidence: TeamBoxRecommendation['confidence'] = 'medium';
  const scores = [
    { key: 'gaming_dev' as const, score: game },
    { key: 'mobile_dev' as const, score: mobile },
    { key: 'ai_team' as const, score: ai },
    { key: 'web_app' as const, score: web },
  ];
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1]?.score ?? 0;

  if (top.score === 0) {
    teamBoxKey = 'web_app';
    confidence = 'low';
  } else {
    teamBoxKey = top.key;
    confidence = top.score >= second + 2 ? 'high' : top.score > second ? 'medium' : 'low';
  }

  const box = findTeamBox(teamBoxKey) ?? TEAM_BOX_CATALOG[1];
  const complexity = assessComplexity(idea, requirements);

  const rationaleParts: string[] = [];
  if (game > 0 && teamBoxKey === 'gaming_dev') rationaleParts.push('game development signals detected');
  if (mobile > 0 && teamBoxKey === 'mobile_dev') rationaleParts.push('mobile platform signals detected');
  if (web > 0 && teamBoxKey === 'web_app') rationaleParts.push('web application signals detected');
  if (ai > 0 && teamBoxKey === 'ai_team') rationaleParts.push('AI/ML signals detected');
  if (!rationaleParts.length) rationaleParts.push('defaulting to a full-stack web delivery team');
  rationaleParts.push(
    complexity.deliveryMode === 'SPEC_DRIVEN'
      ? 'complexity suggests spec-driven delivery first'
      : 'complexity suggests task/story-driven delivery'
  );

  const title =
    idea
      .trim()
      .split(/[.!?\n]/)[0]
      ?.slice(0, 48)
      .trim() || 'New product team';

  return {
    teamBoxKey: box.key,
    teamBoxName: box.name,
    confidence,
    rationale: rationaleParts.join('; '),
    suggestedTeamName: title,
    deliveryMode: complexity.deliveryMode,
    complexityScore: complexity.score,
    complexityLabel: complexity.label,
  };
}

function specDrivenPlan(idea: string, requirements?: string): PlannedWorkItem[] {
  const detail = requirements?.trim() || idea.trim();
  return [
    {
      kind: 'APP_IDEA',
      title: idea.trim().slice(0, 200) || 'Product initiative',
      description: detail,
      taskType: 'SPEC',
      columnKey: 'backlog',
      priority: 'HIGH',
      children: [
        {
          kind: 'SPEC',
          title: 'Product spec & acceptance criteria',
          description: 'Jarvis: consolidate goals, users, scope, and measurable acceptance criteria.',
          taskType: 'SPEC',
          columnKey: 'backlog',
          priority: 'HIGH',
        },
        {
          kind: 'SPEC',
          title: 'Technical approach & risks',
          description: 'Architecture outline, dependencies, and risk register.',
          taskType: 'SPEC',
          columnKey: 'backlog',
          priority: 'MEDIUM',
        },
        {
          kind: 'STORY',
          title: 'Milestone 1 — core user journey',
          description: 'Implement the primary flow end-to-end.',
          taskType: 'STORY',
          columnKey: 'backlog',
          priority: 'HIGH',
        },
        {
          kind: 'STORY',
          title: 'Milestone 2 — hardening & QA',
          description: 'Tests, edge cases, and review gates.',
          taskType: 'STORY',
          columnKey: 'backlog',
          priority: 'MEDIUM',
        },
      ],
    },
  ];
}

function gameDrivenPlan(idea: string, requirements?: string): PlannedWorkItem[] {
  const detail = requirements?.trim() || idea.trim();
  return [
    {
      kind: 'APP_IDEA',
      title: idea.trim().slice(0, 200) || 'Game project',
      description: detail,
      taskType: 'SPEC',
      columnKey: 'backlog',
      priority: 'HIGH',
      children: [
        {
          kind: 'SPEC',
          title: 'Platform & stack decision',
          description:
            'Choose target (Roblox/Luau, Unity/C#, Godot, web, etc.), repo layout, and vertical-slice scope. Record in team context.',
          taskType: 'SPEC',
          columnKey: 'backlog',
          priority: 'HIGH',
        },
        {
          kind: 'SPEC',
          title: 'Game design doc — core loop & mechanics',
          description: 'GDD: goals, core loop, mechanics, progression, and playtest acceptance for slice 1.',
          taskType: 'SPEC',
          columnKey: 'backlog',
          priority: 'HIGH',
        },
        {
          kind: 'STORY',
          title: 'Vertical slice — playable build',
          description: 'Implement core mechanics, minimal UI/HUD, and one complete player journey.',
          taskType: 'STORY',
          columnKey: 'backlog',
          priority: 'HIGH',
        },
        {
          kind: 'STORY',
          title: 'Playtest, polish & QA pass',
          description: 'Playtest script, bug fixes, performance sanity, and review gates.',
          taskType: 'STORY',
          columnKey: 'backlog',
          priority: 'MEDIUM',
        },
      ],
    },
  ];
}

function taskDrivenPlan(idea: string, requirements?: string): PlannedWorkItem[] {
  const detail = requirements?.trim();
  return [
    {
      kind: 'APP_IDEA',
      title: idea.trim().slice(0, 200) || 'Feature initiative',
      description: detail || idea.trim(),
      taskType: 'STORY',
      columnKey: 'backlog',
      priority: 'HIGH',
      children: [
        {
          kind: 'STORY',
          title: 'Clarify scope with user/stakeholder',
          description: 'Confirm acceptance criteria and out-of-scope items.',
          taskType: 'STORY',
          columnKey: 'backlog',
          priority: 'HIGH',
        },
        {
          kind: 'STORY',
          title: 'Implement change',
          description: 'Build and wire the feature or fix.',
          taskType: 'STORY',
          columnKey: 'ready',
          priority: 'HIGH',
        },
        {
          kind: 'TASK',
          title: 'Verify & document',
          description: 'Tests, demo notes, and handoff.',
          taskType: 'CHORE',
          columnKey: 'backlog',
          priority: 'MEDIUM',
        },
      ],
    },
  ];
}

export function buildJarvisWorkPlan(opts: {
  idea: string;
  requirements?: string;
  deliveryMode?: DeliveryMode;
  teamBox?: TeamBoxDefinition | null;
}): JarvisWorkPlan {
  const complexity = assessComplexity(opts.idea, opts.requirements);
  let mode = complexity.deliveryMode;
  if (opts.deliveryMode) {
    mode = opts.deliveryMode;
  }

  const useGamePlan = opts.teamBox?.key === 'gaming_dev';
  const items = useGamePlan
    ? gameDrivenPlan(opts.idea, opts.requirements)
    : mode === 'SPEC_DRIVEN'
      ? specDrivenPlan(opts.idea, opts.requirements)
      : taskDrivenPlan(opts.idea, opts.requirements);

  const boxName = opts.teamBox?.name ?? 'team';
  const summary = useGamePlan
    ? `Jarvis recommends game delivery for ${boxName}: pick platform/language, GDD + vertical slice, then playtest.`
    : mode === 'SPEC_DRIVEN'
      ? `Jarvis recommends spec-driven delivery for ${boxName}: product + technical specs, then milestone stories.`
      : `Jarvis recommends task-driven delivery for ${boxName}: lean stories/tasks suitable for a focused change.`;

  return {
    deliveryMode: mode,
    complexityScore: complexity.score,
    complexityLabel: complexity.label,
    summary,
    items,
  };
}

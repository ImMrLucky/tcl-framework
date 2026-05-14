/**
 * Agent Studio — role + workflow template loader.
 *
 * Source of truth is `packages/agent-core/templates/*.json` (JSON, so a UI or
 * tool can read it without booting Node). Resolution tries several roots because
 * `process.cwd()`, hoisted `node_modules`, and `dist/` layouts differ between
 * dev, CI, and Docker.
 */

import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

/** `undefined` = not resolved yet; `null` = no directory contained roles.json */
let resolvedTemplatesDir: string | null | undefined = undefined;

function candidateTemplateDirs(): string[] {
  const dirs: string[] = [];
  try {
    const pkg = nodeRequire.resolve('agent-core/package.json');
    dirs.push(join(dirname(pkg), 'templates'));
  } catch {
    /* agent-core not installed from this resolution root */
  }
  dirs.push(resolve(HERE, '../../../../agent-core/templates'));
  const cwd = process.cwd();
  dirs.push(resolve(cwd, 'packages/agent-core/templates'));
  dirs.push(resolve(cwd, 'node_modules/agent-core/templates'));
  dirs.push(resolve(cwd, '../agent-core/templates'));
  return [...new Set(dirs)];
}

function getTemplatesDir(): string | null {
  if (resolvedTemplatesDir !== undefined) {
    return resolvedTemplatesDir;
  }
  for (const dir of candidateTemplateDirs()) {
    if (existsSync(join(dir, 'roles.json')) && existsSync(join(dir, 'personas.json'))) {
      resolvedTemplatesDir = dir;
      console.info('[agent-studio][templates] catalogue dir:', dir);
      return dir;
    }
  }
  console.error('[agent-studio][templates] roles.json / personas.json not found. Tried:', candidateTemplateDirs());
  resolvedTemplatesDir = null;
  return null;
}

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  defaultPersona: string;
  defaultCapabilities: string[];
  defaultTools: string[];
  defaultModelUseCases: string[];
  isOrchestrator?: boolean;
}

export interface PersonaTemplate {
  key: string;
  name: string;
  description: string;
  personaMarkdown: string;
}

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  recommendedRoles: string[];
  defaultBoardColumns: Array<{ key: string; label: string }>;
  defaultTasks: Array<{
    title: string;
    description?: string;
    columnKey: string;
    taskType: 'STORY' | 'BUG' | 'SPIKE' | 'RESEARCH' | 'SPEC' | 'REVIEW' | 'CHORE';
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }>;
  reviewGates: Array<{
    afterColumnKey: string;
    gateType:
      | 'SPEC_REVIEW'
      | 'CODE_REVIEW'
      | 'SECURITY_REVIEW'
      | 'QA_REVIEW'
      | 'RELEASE_APPROVAL'
      | 'CUSTOM';
    requiredRole?: string;
  }>;
}

/** `undefined` = never loaded successfully; do not use truthiness — `[]` is a valid cache. */
let cachedRoles: RoleTemplate[] | undefined = undefined;
let cachedWorkflows: WorkflowTemplate[] | undefined = undefined;
let cachedPersonas: PersonaTemplate[] | undefined = undefined;

export function loadPersonaTemplates(): PersonaTemplate[] {
  if (cachedPersonas !== undefined) return cachedPersonas;
  const dir = getTemplatesDir();
  if (!dir) {
    return [];
  }
  try {
    const raw = readFileSync(join(dir, 'personas.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    cachedPersonas = Array.isArray(parsed) ? (parsed as PersonaTemplate[]) : [];
  } catch (err) {
    console.warn('[agent-studio][templates] failed to load personas.json from', join(dir, 'personas.json'), err);
    return [];
  }
  return cachedPersonas;
}

export function findPersonaTemplate(key: string): PersonaTemplate | null {
  return loadPersonaTemplates().find((p) => p.key === key) ?? null;
}

export function loadRoleTemplates(): RoleTemplate[] {
  if (cachedRoles !== undefined) return cachedRoles;
  const dir = getTemplatesDir();
  if (!dir) {
    return [];
  }
  try {
    const raw = readFileSync(join(dir, 'roles.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    cachedRoles = Array.isArray(parsed) ? (parsed as RoleTemplate[]) : [];
  } catch (err) {
    console.warn('[agent-studio][templates] failed to load roles.json from', join(dir, 'roles.json'), err);
    return [];
  }
  return cachedRoles;
}

export function loadWorkflowTemplates(): WorkflowTemplate[] {
  if (cachedWorkflows !== undefined) return cachedWorkflows;
  const dir = getTemplatesDir();
  if (!dir) {
    return [];
  }
  try {
    const raw = readFileSync(join(dir, 'workflows.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    cachedWorkflows = Array.isArray(parsed) ? (parsed as WorkflowTemplate[]) : [];
  } catch (err) {
    console.warn('[agent-studio][templates] failed to load workflows.json from', join(dir, 'workflows.json'), err);
    return [];
  }
  return cachedWorkflows;
}

export function findRoleTemplate(key: string): RoleTemplate | null {
  return loadRoleTemplates().find((r) => r.key === key) ?? null;
}

export function findWorkflowTemplate(key: string): WorkflowTemplate | null {
  return loadWorkflowTemplates().find((w) => w.key === key) ?? null;
}

/**
 * Reset cache (tests / hot reload).
 */
export function _resetTemplateCacheForTests(): void {
  cachedRoles = undefined;
  cachedWorkflows = undefined;
  cachedPersonas = undefined;
  resolvedTemplatesDir = undefined;
}

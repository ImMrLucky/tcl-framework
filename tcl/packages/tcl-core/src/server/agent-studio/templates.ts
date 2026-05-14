/**
 * Agent Studio — role + workflow template loader.
 *
 * Source of truth is `packages/agent-core/templates/*.json` (JSON, so a UI or
 * tool can read it without booting Node). We resolve the path relative to
 * this module so it works in both `ts-node` dev mode and after a `tsc` build.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

// In dev (ts-node):     packages/tcl-core/src/server/agent-studio/ -> ../../../../agent-core/templates
// After build (tsc):    packages/tcl-core/dist/server/agent-studio/ -> ../../../../agent-core/templates
const TEMPLATES_DIR = resolve(HERE, '../../../../agent-core/templates');

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

let cachedRoles: RoleTemplate[] | null = null;
let cachedWorkflows: WorkflowTemplate[] | null = null;
let cachedPersonas: PersonaTemplate[] | null = null;

export function loadPersonaTemplates(): PersonaTemplate[] {
  if (cachedPersonas) return cachedPersonas;
  try {
    const raw = readFileSync(resolve(TEMPLATES_DIR, 'personas.json'), 'utf8');
    cachedPersonas = JSON.parse(raw) as PersonaTemplate[];
  } catch (err) {
    console.warn('[agent-studio][templates] failed to load personas.json', err);
    cachedPersonas = [];
  }
  return cachedPersonas;
}

export function findPersonaTemplate(key: string): PersonaTemplate | null {
  return loadPersonaTemplates().find((p) => p.key === key) ?? null;
}

export function loadRoleTemplates(): RoleTemplate[] {
  if (cachedRoles) return cachedRoles;
  try {
    const raw = readFileSync(resolve(TEMPLATES_DIR, 'roles.json'), 'utf8');
    cachedRoles = JSON.parse(raw) as RoleTemplate[];
  } catch (err) {
    console.warn('[agent-studio][templates] failed to load roles.json', err);
    cachedRoles = [];
  }
  return cachedRoles;
}

export function loadWorkflowTemplates(): WorkflowTemplate[] {
  if (cachedWorkflows) return cachedWorkflows;
  try {
    const raw = readFileSync(resolve(TEMPLATES_DIR, 'workflows.json'), 'utf8');
    cachedWorkflows = JSON.parse(raw) as WorkflowTemplate[];
  } catch (err) {
    console.warn('[agent-studio][templates] failed to load workflows.json', err);
    cachedWorkflows = [];
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
  cachedRoles = null;
  cachedWorkflows = null;
  cachedPersonas = null;
}

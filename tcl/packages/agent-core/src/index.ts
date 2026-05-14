/**
 * agent-core — base contracts for Agent Studio.
 *
 * This package is intentionally small: it exposes the data shapes other
 * `agent-*` packages and the `tcl-core` Express layer rely on. Behaviour
 * (orchestration, IO, persistence) lives in the consumer packages.
 */

// ---------------------------------------------------------------------------
// Pause primitives — appear on Org / Team / Agent rows.
// ---------------------------------------------------------------------------
export interface PauseState {
  pausedAt: string | null;
  pausedBy: string | null;
  pauseReason: string | null;
}

// ---------------------------------------------------------------------------
// Tenancy + collaboration entities.
// ---------------------------------------------------------------------------
export interface Team extends PauseState {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  workflowTemplateKey: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AgentStatus = 'IDLE' | 'BUSY' | 'WAITING_REVIEW' | 'PAUSED' | 'ERROR';

export interface Agent extends PauseState {
  id: string;
  orgId: string;
  teamId: string;
  name: string;
  roleTemplateKey: string | null;
  isOrchestrator: boolean;
  persona: string | null;
  status: AgentStatus;
  theme: Record<string, unknown>;
  capabilities: string[];
  tools: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfig {
  id: string;
  orgId: string;
  agentId: string;
  version: number;
  config: Record<string, unknown>;
  notes: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Kanban + tasks.
// ---------------------------------------------------------------------------
export interface BoardColumn {
  key: string;
  label: string;
}

export interface KanbanBoard {
  id: string;
  orgId: string;
  teamId: string;
  name: string;
  columns: BoardColumn[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TaskType = 'STORY' | 'BUG' | 'SPIKE' | 'RESEARCH' | 'SPEC' | 'REVIEW' | 'CHORE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TaskStatus = 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE' | 'CANCELLED';

export interface Task {
  id: string;
  orgId: string;
  teamId: string;
  boardId: string;
  columnKey: string;
  position: number;
  title: string;
  description: string | null;
  taskType: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  assignedAgentId: string | null;
  createdBy: string | null;
  externalRef: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type ReviewGateType =
  | 'SPEC_REVIEW'
  | 'CODE_REVIEW'
  | 'SECURITY_REVIEW'
  | 'QA_REVIEW'
  | 'RELEASE_APPROVAL'
  | 'CUSTOM';

export type ReviewGateStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'SKIPPED';

export interface ReviewGate {
  id: string;
  orgId: string;
  taskId: string;
  gateType: ReviewGateType;
  status: ReviewGateStatus;
  requiredRole: string | null;
  comment: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Memory + learning.
// ---------------------------------------------------------------------------
export type ContextScope = 'TEAM' | 'AGENT';

export interface SharedContext {
  id: string;
  orgId: string;
  scope: ContextScope;
  teamId: string | null;
  agentId: string | null;
  key: string;
  content: string | null;
  data: Record<string, unknown>;
  pinned: boolean;
  source: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MistakeSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Mistake {
  id: string;
  orgId: string;
  teamId: string;
  agentId: string | null;
  scope: ContextScope;
  title: string;
  description: string | null;
  rule: string;
  severity: MistakeSeverity;
  sourceTaskId: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Templates (role + workflow). Loader implementations live in tcl-core for
// the MVP; this package exports just the shapes + the canonical JSON file
// names so multiple consumers agree on the format.
// ---------------------------------------------------------------------------
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

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  recommendedRoles: string[];
  defaultBoardColumns: BoardColumn[];
  defaultTasks: Array<{
    title: string;
    description?: string;
    columnKey: string;
    taskType: TaskType;
    priority?: TaskPriority;
  }>;
  reviewGates: Array<{
    afterColumnKey: string;
    gateType: ReviewGateType;
    requiredRole?: string;
  }>;
}

export const ROLE_TEMPLATES_FILE = 'roles.json';
export const WORKFLOW_TEMPLATES_FILE = 'workflows.json';

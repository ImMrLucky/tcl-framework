// Mirrors of the server-side shapes in
// `packages/tcl-core/src/server/agent-studio/`. Kept narrow on purpose —
// only the fields the UI actually reads.

export type AgentStatus = 'IDLE' | 'BUSY' | 'WAITING_REVIEW' | 'PAUSED' | 'ERROR';
export type ContextScope = 'TEAM' | 'AGENT';

export interface AgentStudioSettings {
  org_id: string;
  enabled: boolean;
  paused_at: string | null;
  paused_by: string | null;
  pause_reason: string | null;
  default_model: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentTeam {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  workflow_template_key: string | null;
  paused_at: string | null;
  paused_by: string | null;
  pause_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  org_id: string;
  team_id: string;
  name: string;
  role_template_key: string | null;
  is_orchestrator: boolean;
  persona: string | null;
  status: AgentStatus;
  theme: Record<string, unknown>;
  capabilities: string[];
  tools: string[];
  paused_at: string | null;
  paused_by: string | null;
  pause_reason: string | null;
  created_at: string;
  updated_at: string;
  role_template_id?: string | null;
  persona_template_id?: string | null;
  template_pack_id?: string | null;
  agent_file_mode?: 'managed' | 'advanced' | 'custom';
}

export interface AgentConfigVersion {
  id: string;
  agent_id: string;
  version: number;
  config: Record<string, unknown>;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BoardColumn {
  key: string;
  label: string;
}

export type ReviewMode = 'AUTO_APPROVED' | 'HUMAN' | 'AGENT' | 'MIXED';
export type SwimlaneMode = 'none' | 'agent' | 'priority' | 'type';

export interface BoardReviewPolicy {
  defaultMode: ReviewMode;
  requireGatesBeforeDone: boolean;
  autoCreateGatesOnEnterReview: boolean;
  defaultGateTypes: ReviewGateType[];
}

export interface BoardSettings {
  swimlaneMode: SwimlaneMode;
  reviewPolicy: BoardReviewPolicy;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  swimlaneMode: 'none',
  reviewPolicy: {
    defaultMode: 'HUMAN',
    requireGatesBeforeDone: true,
    autoCreateGatesOnEnterReview: true,
    defaultGateTypes: ['CODE_REVIEW', 'QA_REVIEW'],
  },
};

export interface KanbanBoard {
  id: string;
  team_id: string;
  name: string;
  columns: BoardColumn[];
  is_default: boolean;
  settings?: BoardSettings;
}

export interface BoardPauseState {
  orgPaused: boolean;
  teamPaused: boolean;
}

export type TaskType = 'STORY' | 'BUG' | 'SPIKE' | 'RESEARCH' | 'SPEC' | 'REVIEW' | 'CHORE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TaskStatus = 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE' | 'CANCELLED';

export interface Task {
  id: string;
  org_id: string;
  team_id: string;
  board_id: string;
  column_key: string;
  position: number;
  title: string;
  description: string | null;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_agent_id: string | null;
  external_ref: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  task_id: string;
  gate_type: ReviewGateType;
  status: ReviewGateStatus;
  required_role: string | null;
  comment: string | null;
  decided_by: string | null;
  decided_at: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ContextEntry {
  id: string;
  scope: ContextScope;
  team_id: string | null;
  agent_id: string | null;
  key: string;
  content: string | null;
  data: Record<string, unknown>;
  pinned: boolean;
  source: string | null;
  updated_at: string;
}

export type MistakeSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Mistake {
  id: string;
  team_id: string;
  agent_id: string | null;
  scope: ContextScope;
  title: string;
  description: string | null;
  rule: string;
  severity: MistakeSeverity;
  is_active: boolean;
  created_at: string;
}

export interface ProviderKeyRow {
  id: string;
  provider: string;
  label: string;
  key_alg: string;
  key_version: number;
  metadata: Record<string, unknown>;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface RoutingRule {
  id: string;
  scope: 'ORG' | 'TEAM' | 'AGENT';
  team_id: string | null;
  agent_id: string | null;
  use_case: string;
  provider: string;
  model: string;
  provider_key_id: string | null;
  fallback: Array<{ provider: string; model: string; provider_key_id: string | null }>;
  params: Record<string, unknown>;
  is_active: boolean;
}

export interface McpServerRow {
  id: string;
  team_id: string | null;
  name: string;
  transport: 'stdio' | 'sse' | 'websocket' | 'http';
  command: string | null;
  url: string | null;
  args: string[];
  env: Record<string, string>;
  enabled_tools: string[];
  is_active: boolean;
}

export interface IntegrationRow {
  id: string;
  team_id: string | null;
  kind: 'jira' | 'azure-devops' | 'github' | 'gitlab' | 'linear' | 'custom';
  name: string;
  config: Record<string, unknown>;
  status: 'NEW' | 'READY' | 'ERROR' | 'DISABLED';
  last_synced_at: string | null;
  last_error: string | null;
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
  defaultBoardColumns: BoardColumn[];
  defaultTasks: Array<{
    title: string;
    description?: string;
    columnKey: string;
    taskType: TaskType;
    priority?: TaskPriority;
  }>;
  reviewGates: Array<{ afterColumnKey: string; gateType: ReviewGateType; requiredRole?: string }>;
}

export interface AuditEvent {
  id: string;
  org_id: string;
  team_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  actor_user_id: string | null;
  actor_kind: 'USER' | 'AGENT' | 'SYSTEM';
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export type NeedsAttentionType = 'task' | 'agent' | 'review' | 'integration' | 'mcp';

export interface NeedsAttentionItem {
  type: NeedsAttentionType;
  label: string;
  description: string;
  teamId?: string;
  taskId?: string;
  agentId?: string;
}

/** Response from `GET /api/agent-studio/summary`. */
export interface AgentStudioSummary {
  teamsTotal: number;
  teamsPaused: number;
  agentsTotal: number;
  agentsPaused: number;
  tasksTotal: number;
  tasksInProgress: number;
  tasksBlocked: number;
  reviewsPending: number;
  recentAuditEvents: AuditEvent[];
  recentRuns: unknown[];
  needsAttention: NeedsAttentionItem[];
  orgPaused: boolean;
}

/** Response from `GET /api/agent-studio/teams/:teamId/command-center`. */
export interface TeamCommandCenter {
  team: AgentTeam;
  agentsTotal: number;
  agentsPaused: number;
  orchestratorCount: number;
  tasksTotal: number;
  tasksInProgress: number;
  tasksBlocked: number;
  tasksInReview: number;
  pendingReviewGates: number;
  recentCompleted: Task[];
  recentAudit: AuditEvent[];
  recentMistakes: Mistake[];
  contextSummary: string | null;
  orgPaused: boolean;
}

export interface TemplatePackRow {
  id: string;
  org_id: string | null;
  key: string;
  name: string;
  description: string | null;
  category: string;
  pack_type: string;
  is_system: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentMarkdownFile {
  id: string;
  org_id: string;
  team_id: string;
  agent_id: string;
  file_key: string;
  file_name: string;
  file_path: string;
  file_type: string;
  markdown: string;
  is_required: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

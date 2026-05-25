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

export type WorkItemKind = 'APP_IDEA' | 'STORY' | 'TASK';

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

export interface JarvisWorkPlan {
  deliveryMode: DeliveryMode;
  complexityScore: number;
  complexityLabel: string;
  summary: string;
  items: unknown[];
}

export interface TeamBoxCatalogEntry {
  key: string;
  name: string;
  description: string;
  icon: string;
  workflowTemplateKey: string;
  exampleObjective: string;
  agentRoleCount: number;
}

export interface ProvisionedTeamAgent {
  agentId: string;
  name: string;
  roleTemplateKey: string;
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

export type AgentTaskDisposition = 'jarvis' | 'unassign';

export interface AgentRemovalImpact {
  agentId: string;
  agentName: string;
  isOrchestrator: boolean;
  assignedOpenTaskCount: number;
  jarvisAgentId: string | null;
  jarvisAgentName: string | null;
  defaultDisposition: AgentTaskDisposition;
}

export interface AgentRemovalResult {
  agentId: string;
  agentName: string;
  teamId: string;
  tasksUpdated: number;
  disposition: AgentTaskDisposition;
  jarvisAgentId: string | null;
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

export interface AgentModelConfig {
  provider: string;
  model: string;
  providerKeyId: string | null;
  source?: 'AGENT' | 'TEAM' | 'ORG' | 'DEFAULT';
}

export interface AgentModelConfigResponse {
  config: AgentModelConfig;
  rules: RoutingRule[];
  resolved?: {
    provider: string;
    model: string;
    providerKeyId: string | null;
    source: string;
  };
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
  runtimeReadiness: RuntimeReadiness;
}

export type RuntimeExecutionMode = 'none' | 'local' | 'cloud' | 'local_and_cloud';

export interface RuntimeReadiness {
  executionMode: RuntimeExecutionMode;
  canRunAgents: boolean;
  planningUsesLlm: boolean;
  localRunnersTotal: number;
  localRunnersOnline: number;
  localVendorsReady: number;
  cloudProviderKeys: number;
  routingRulesActive: number;
  hints: string[];
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

export type TeamRunMode =
  | 'MANUAL'
  | 'ONE_STEP'
  | 'RUN_UNTIL_BLOCKED'
  | 'RUN_UNTIL_REVIEW'
  | 'RUN_UNTIL_DONE'
  | 'CONTINUOUS';

export type TeamRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'WAITING_FOR_HUMAN'
  | 'WAITING_FOR_REVIEW'
  | 'BLOCKED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export interface TeamRun {
  id: string;
  org_id: string;
  team_id: string;
  name: string;
  objective: string;
  run_mode: TeamRunMode;
  status: TeamRunStatus;
  orchestrator_agent_id: string | null;
  max_steps: number;
  completed_steps: number;
  local_runner_id: string | null;
  last_heartbeat_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type TeamEventActorType = 'SYSTEM' | 'USER' | 'AGENT' | 'JARVIS' | 'LOCAL_RUNNER';

export interface TeamEventLogEntry {
  id: string;
  team_id: string;
  team_run_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  sequence: number;
  event_type: string;
  actor_type: TeamEventActorType;
  actor_name: string | null;
  summary: string;
  jsonl: Record<string, unknown>;
  created_at: string;
}

export interface LocalRunner {
  id: string;
  org_id: string;
  name: string;
  device_label: string | null;
  status: string;
  last_seen_at: string | null;
  capabilities: Record<string, unknown>;
}

export interface LocalVendorRef {
  id: string;
  provider: string;
  label: string;
  local_key_ref: string;
  key_preview: string | null;
  status: string;
  supported_models: unknown[];
}

export interface AgentPrivateContext {
  agent_id: string;
  summary: string;
  current_task_id: string | null;
  memory: Record<string, unknown>;
  blockers: unknown[];
  updated_at: string;
}

export type ExecutionMode = 'LOCAL_RUNNER_DEFAULT' | 'CLOUD_ENCRYPTED_OPTIONAL' | 'DISABLED';

export type StudioTclTrigger =
  | 'AGENT_RUN_COMPLETE'
  | 'MANUAL'
  | 'IDE_DISPATCH'
  | 'JARVIS_STEP'
  | 'TEAM_EVENT';

export interface StudioTclSuggestion {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  suggestedAction: string;
  example?: string;
}

export interface StudioTclIssueSummary {
  id: string;
  title: string;
  severity: string;
  category: string;
  whyItMatters: string;
  recommendedAction: string;
}

export interface StudioTclReport {
  analysisId?: string;
  trigger: StudioTclTrigger;
  teamId?: string;
  agentRunId?: string;
  scores: {
    truth: number | null;
    evidence: number | null;
    consistency: number | null;
    overall: number | null;
  };
  refusal: boolean;
  claimCount: number;
  issueCount: number;
  issues: StudioTclIssueSummary[];
  suggestions: StudioTclSuggestion[];
  summary?: string;
  durationMs: number;
  engineVersion?: string;
}

export interface PatchProposalRow {
  id: string;
  org_id: string;
  team_id: string;
  tcl_analysis_id: string | null;
  title: string;
  summary: string | null;
  files: Array<{ path: string; content: string; action?: string }>;
  unified_diff: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'SUPERSEDED';
  created_at: string;
  updated_at: string;
}

export interface TclAnalysisRow {
  id: string;
  org_id: string;
  team_id: string;
  agent_run_id: string | null;
  team_run_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  trigger: StudioTclTrigger;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  input_snapshot: Record<string, unknown>;
  report: StudioTclReport | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

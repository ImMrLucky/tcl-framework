import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from '../auth.service';
import {
  Agent,
  AgentConfigVersion,
  AgentModelConfigResponse,
  AgentRemovalImpact,
  AgentRemovalResult,
  AgentTaskDisposition,
  AgentStudioSettings,
  AgentTeam,
  ProvisionedTeamAgent,
  TeamBoxCatalogEntry,
  TeamBoxRecommendation,
  JarvisWorkPlan,
  DeliveryMode,
  WorkItemKind,
  AuditEvent,
  TclAnalysisRow,
  PatchProposalRow,
  StudioTclReport,
  AgentStudioSummary,
  TeamCommandCenter,
  TeamRun,
  TeamRunMode,
  TeamEventLogEntry,
  LocalRunner,
  LocalVendorRef,
  AgentPrivateContext,
  PersonaTemplate,
  TemplatePackRow,
  AgentMarkdownFile,
  ContextEntry,
  ContextScope,
  IntegrationRow,
  BoardPauseState,
  BoardSettings,
  KanbanBoard,
  McpServerRow,
  Mistake,
  ProviderKeyRow,
  ReviewGate,
  ReviewGateStatus,
  ReviewGateType,
  RoleTemplate,
  RoutingRule,
  Task,
  TaskPriority,
  TaskType,
  WorkflowTemplate,
} from './agent-studio.types';

interface CreateTeamPayload {
  name: string;
  description?: string;
  workflowTemplateKey?: string;
  projectId?: string;
}

interface CreateAgentPayload {
  name: string;
  roleTemplateKey?: string;
  isOrchestrator?: boolean;
  persona?: string;
  capabilities?: string[];
  tools?: string[];
  theme?: Record<string, unknown>;
  templatePackKey?: string;
  personaTemplateKey?: string;
  roleTemplateId?: string;
  personaTemplateId?: string;
  generateAgentFiles?: boolean;
}

interface CreateTaskPayload {
  title: string;
  description?: string;
  columnKey?: string;
  taskType?: TaskType;
  priority?: TaskPriority;
  assignedAgentId?: string;
}

@Injectable({ providedIn: 'root' })
export class AgentStudioService {
  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {}

  private get apiUrl(): string {
    if (typeof window !== 'undefined') {
      const configured = (window as any).__TCL_API_URL;
      if (configured) {
        return configured;
      }
      // Same-origin /api/* → Netlify proxy (must match AuthInterceptor + login session).
      return window.location.origin;
    }
    return '';
  }

  private url(path: string): string {
    return `${this.apiUrl}/api/agent-studio${path}`;
  }

  // -------------------------------------------------------------------------
  // Settings + global pause.
  // -------------------------------------------------------------------------
  getSettings(): Observable<{ settings: AgentStudioSettings }> {
    return this.http.get<{ settings: AgentStudioSettings }>(this.url('/settings'));
  }

  updateSettings(body: Partial<{ defaultModel: string; settings: Record<string, unknown> }>): Observable<{ settings: AgentStudioSettings }> {
    return this.http.patch<{ settings: AgentStudioSettings }>(this.url('/settings'), body);
  }

  pauseAll(reason?: string): Observable<{ settings: AgentStudioSettings }> {
    return this.http.post<{ settings: AgentStudioSettings }>(this.url('/pause'), { reason });
  }

  resumeAll(): Observable<{ settings: AgentStudioSettings }> {
    return this.http.post<{ settings: AgentStudioSettings }>(this.url('/resume'), {});
  }

  // -------------------------------------------------------------------------
  // Templates.
  // -------------------------------------------------------------------------
  listRoleTemplates(): Observable<{ templates: RoleTemplate[] }> {
    return this.http.get<{ templates: RoleTemplate[] }>(this.url('/templates/roles'));
  }

  listWorkflowTemplates(): Observable<{ templates: WorkflowTemplate[] }> {
    return this.http.get<{ templates: WorkflowTemplate[] }>(this.url('/templates/workflows'));
  }

  listPersonaTemplates(): Observable<{ templates: PersonaTemplate[] }> {
    return this.http.get<{ templates: PersonaTemplate[] }>(this.url('/templates/personas'));
  }

  listTemplatePacks(): Observable<{ packs: TemplatePackRow[] }> {
    return this.http.get<{ packs: TemplatePackRow[] }>(this.url('/template-packs'));
  }

  listRolesCatalog(): Observable<{ catalog: RoleTemplate[]; dbRoles: unknown[] }> {
    return this.http.get<{ catalog: RoleTemplate[]; dbRoles: unknown[] }>(this.url('/roles'));
  }

  listPersonasCatalog(): Observable<{ catalog: PersonaTemplate[]; dbPersonas: unknown[] }> {
    return this.http.get<{ catalog: PersonaTemplate[]; dbPersonas: unknown[] }>(this.url('/personas'));
  }

  listTemplateAssets(): Observable<{ assets: unknown[] }> {
    return this.http.get<{ assets: unknown[] }>(this.url('/template-assets'));
  }

  listAgentMarkdownFiles(agentId: string): Observable<{ files: AgentMarkdownFile[] }> {
    return this.http.get<{ files: AgentMarkdownFile[] }>(this.url(`/agents/${agentId}/files`));
  }

  seedAgentMarkdownFiles(agentId: string): Observable<{ inserted: number; repaired: number; skipped: number }> {
    return this.http.post<{ inserted: number; repaired: number; skipped: number }>(
      this.url(`/agents/${agentId}/files/_seed`),
      {}
    );
  }

  updateAgentMarkdownFile(
    agentId: string,
    fileId: string,
    body: { markdown?: string; isActive?: boolean; changeNote?: string }
  ): Observable<{ file: AgentMarkdownFile }> {
    return this.http.patch<{ file: AgentMarkdownFile }>(this.url(`/agents/${agentId}/files/${fileId}`), body);
  }

  listAgentFileVersions(agentId: string, fileId: string): Observable<{ versions: unknown[] }> {
    return this.http.get<{ versions: unknown[] }>(this.url(`/agents/${agentId}/files/${fileId}/versions`));
  }

  previewAgentPrompt(
    agentId: string,
    body: {
      taskId?: string;
      activeFilePath?: string;
      activeFileContent?: string;
      selectedText?: string;
      userPrompt?: string;
    }
  ): Observable<{ filesUsed: unknown[]; composedPrompt: string }> {
    return this.http.post<{ filesUsed: unknown[]; composedPrompt: string }>(
      this.url(`/agents/${agentId}/prompt-preview`),
      body
    );
  }

  // -------------------------------------------------------------------------
  // Teams.
  // -------------------------------------------------------------------------
  listTeams(): Observable<{ teams: AgentTeam[] }> {
    return this.http.get<{ teams: AgentTeam[] }>(this.url('/teams'));
  }

  getSummary(): Observable<AgentStudioSummary> {
    return this.http.get<AgentStudioSummary>(this.url('/summary'));
  }

  getTeamCommandCenter(teamId: string): Observable<TeamCommandCenter> {
    return this.http.get<TeamCommandCenter>(this.url(`/teams/${teamId}/command-center`));
  }

  createTeam(body: CreateTeamPayload): Observable<{ team: AgentTeam; board: KanbanBoard }> {
    return this.http.post<{ team: AgentTeam; board: KanbanBoard }>(this.url('/teams'), body);
  }

  listTeamBoxes(): Observable<{ boxes: TeamBoxCatalogEntry[] }> {
    return this.http.get<{ boxes: TeamBoxCatalogEntry[] }>(this.url('/team-boxes'));
  }

  recommendTeamBox(body: {
    idea: string;
    requirements?: string;
  }): Observable<{ recommendation: TeamBoxRecommendation; planPreview: JarvisWorkPlan }> {
    return this.http.post<{ recommendation: TeamBoxRecommendation; planPreview: JarvisWorkPlan }>(
      this.url('/team-boxes/recommend'),
      body
    );
  }

  planTeamWork(
    teamId: string,
    body: { idea: string; requirements?: string; deliveryMode?: DeliveryMode; replaceBacklog?: boolean }
  ): Observable<{ plan: JarvisWorkPlan; tasks: Task[] }> {
    return this.http.post<{ plan: JarvisWorkPlan; tasks: Task[] }>(
      this.url(`/teams/${teamId}/plan-work`),
      body
    );
  }

  createTeamFromBox(body: {
    name: string;
    description?: string;
    teamBoxKey: string;
    projectId?: string;
    appIdeaTitle?: string;
    appIdeaDescription?: string;
    idea?: string;
    requirements?: string;
    autoPlan?: boolean;
    deliveryMode?: DeliveryMode;
    startWorking?: boolean;
  }): Observable<{
    team: AgentTeam;
    board: KanbanBoard;
    teamBoxKey: string;
    jarvisAgentId: string | null;
    agents: ProvisionedTeamAgent[];
    appIdeaTask?: Task;
    run?: TeamRun;
  }> {
    return this.http.post<{
      team: AgentTeam;
      board: KanbanBoard;
      teamBoxKey: string;
      jarvisAgentId: string | null;
      agents: ProvisionedTeamAgent[];
      appIdeaTask?: Task;
      run?: TeamRun;
    }>(this.url('/teams/from-box'), body);
  }

  listTeamWorkItems(teamId: string): Observable<{ workItems: Task[] }> {
    return this.http.get<{ workItems: Task[] }>(this.url(`/teams/${teamId}/work-items`));
  }

  createWorkItem(
    teamId: string,
    body: {
      kind: WorkItemKind;
      title: string;
      description?: string;
      parentTaskId?: string;
      stories?: Array<{ title: string; description?: string }>;
    }
  ): Observable<{ workItem: Task; stories: Task[] }> {
    return this.http.post<{ workItem: Task; stories: Task[] }>(
      this.url(`/teams/${teamId}/work-items`),
      body
    );
  }

  startWorking(
    teamId: string,
    body?: {
      objective?: string;
      runMode?: TeamRunMode;
      maxSteps?: number;
      taskIds?: string[];
      useJarvis?: boolean;
    }
  ): Observable<{ run: TeamRun; objective: string }> {
    return this.http.post<{ run: TeamRun; objective: string }>(
      this.url(`/teams/${teamId}/start-working`),
      body ?? {}
    );
  }

  getTeam(teamId: string): Observable<{ team: AgentTeam }> {
    return this.http.get<{ team: AgentTeam }>(this.url(`/teams/${teamId}`));
  }

  updateTeam(teamId: string, body: Partial<CreateTeamPayload>): Observable<{ team: AgentTeam }> {
    return this.http.patch<{ team: AgentTeam }>(this.url(`/teams/${teamId}`), body);
  }

  deleteTeam(teamId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/teams/${teamId}`));
  }

  pauseTeam(teamId: string, reason?: string): Observable<{ team: AgentTeam }> {
    return this.http.post<{ team: AgentTeam }>(this.url(`/teams/${teamId}/pause`), { reason });
  }

  resumeTeam(teamId: string): Observable<{ team: AgentTeam }> {
    return this.http.post<{ team: AgentTeam }>(this.url(`/teams/${teamId}/resume`), {});
  }

  // -------------------------------------------------------------------------
  // Agents.
  // -------------------------------------------------------------------------
  listAgents(teamId: string): Observable<{ agents: Agent[] }> {
    return this.http.get<{ agents: Agent[] }>(this.url(`/teams/${teamId}/agents`));
  }

  createAgent(teamId: string, body: CreateAgentPayload): Observable<{ agent: Agent }> {
    return this.http.post<{ agent: Agent }>(this.url(`/teams/${teamId}/agents`), body);
  }

  getAgent(agentId: string): Observable<{ agent: Agent }> {
    return this.http.get<{ agent: Agent }>(this.url(`/agents/${agentId}`));
  }

  updateAgent(agentId: string, body: Partial<CreateAgentPayload> & { status?: string }): Observable<{ agent: Agent }> {
    return this.http.patch<{ agent: Agent }>(this.url(`/agents/${agentId}`), body);
  }

  getAgentRemovalImpact(agentId: string): Observable<{ impact: AgentRemovalImpact }> {
    return this.http.get<{ impact: AgentRemovalImpact }>(this.url(`/agents/${agentId}/removal-impact`));
  }

  deleteAgent(agentId: string, body?: { taskDisposition?: AgentTaskDisposition }): Observable<AgentRemovalResult> {
    return this.http.request<AgentRemovalResult>('DELETE', this.url(`/agents/${agentId}`), {
      body: body ?? {},
    });
  }

  pauseAgent(agentId: string, reason?: string): Observable<{ agent: Agent }> {
    return this.http.post<{ agent: Agent }>(this.url(`/agents/${agentId}/pause`), { reason });
  }

  resumeAgent(agentId: string): Observable<{ agent: Agent }> {
    return this.http.post<{ agent: Agent }>(this.url(`/agents/${agentId}/resume`), {});
  }

  // -------------------------------------------------------------------------
  // Agent configs.
  // -------------------------------------------------------------------------
  listAgentConfigs(agentId: string): Observable<{ configs: AgentConfigVersion[] }> {
    return this.http.get<{ configs: AgentConfigVersion[] }>(this.url(`/agents/${agentId}/configs`));
  }

  publishAgentConfig(agentId: string, config: Record<string, unknown>, notes?: string): Observable<{ config: AgentConfigVersion }> {
    return this.http.post<{ config: AgentConfigVersion }>(this.url(`/agents/${agentId}/configs`), { config, notes });
  }

  getAgentModelConfig(agentId: string): Observable<AgentModelConfigResponse> {
    return this.http.get<AgentModelConfigResponse>(this.url(`/agents/${agentId}/model-config`));
  }

  setAgentModelConfig(
    agentId: string,
    body: { provider: string; model: string; providerKeyId?: string | null }
  ): Observable<AgentModelConfigResponse> {
    return this.http.put<AgentModelConfigResponse>(this.url(`/agents/${agentId}/model-config`), body);
  }

  // -------------------------------------------------------------------------
  // Board + tasks.
  // -------------------------------------------------------------------------
  getBoard(teamId: string): Observable<{
    board: KanbanBoard;
    tasks: Task[];
    reviewGatesByTaskId: Record<string, ReviewGate[]>;
    pause: BoardPauseState;
  }> {
    return this.http.get<{
      board: KanbanBoard;
      tasks: Task[];
      reviewGatesByTaskId: Record<string, ReviewGate[]>;
      pause: BoardPauseState;
    }>(this.url(`/teams/${teamId}/board`));
  }

  updateBoard(
    boardId: string,
    body: { settings?: BoardSettings; columns?: KanbanBoard['columns']; name?: string }
  ): Observable<{ board: KanbanBoard }> {
    return this.http.patch<{ board: KanbanBoard }>(this.url(`/boards/${boardId}`), body);
  }

  createTask(teamId: string, body: CreateTaskPayload): Observable<{ task: Task }> {
    return this.http.post<{ task: Task }>(this.url(`/teams/${teamId}/tasks`), body);
  }

  updateTask(
    taskId: string,
    body: Partial<
      Task & {
        columnKey: string;
        assignedAgentId: string | null;
        metadata: Record<string, unknown>;
      }
    >
  ): Observable<{ task: Task }> {
    return this.http.patch<{ task: Task }>(this.url(`/tasks/${taskId}`), body);
  }

  deleteTask(taskId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/tasks/${taskId}`));
  }

  // -------------------------------------------------------------------------
  // Review gates.
  // -------------------------------------------------------------------------
  listReviewGates(taskId: string): Observable<{ gates: ReviewGate[] }> {
    return this.http.get<{ gates: ReviewGate[] }>(this.url(`/tasks/${taskId}/review-gates`));
  }

  createReviewGate(
    taskId: string,
    gateType: ReviewGateType,
    requiredRole?: string,
    metadata?: Record<string, unknown>
  ): Observable<{ gate: ReviewGate }> {
    return this.http.post<{ gate: ReviewGate }>(this.url(`/tasks/${taskId}/review-gates`), {
      gateType,
      requiredRole,
      metadata,
    });
  }

  decideReviewGate(gateId: string, status: ReviewGateStatus, comment?: string): Observable<{ gate: ReviewGate }> {
    return this.http.post<{ gate: ReviewGate }>(this.url(`/review-gates/${gateId}/decision`), { status, comment });
  }

  // -------------------------------------------------------------------------
  // Contexts.
  // -------------------------------------------------------------------------
  listContexts(filter: { teamId?: string; agentId?: string; scope?: ContextScope } = {}): Observable<{ entries: ContextEntry[] }> {
    const params: Record<string, string> = {};
    if (filter.teamId) params['teamId'] = filter.teamId;
    if (filter.agentId) params['agentId'] = filter.agentId;
    if (filter.scope) params['scope'] = filter.scope;
    return this.http.get<{ entries: ContextEntry[] }>(this.url('/contexts'), { params });
  }

  createContext(body: {
    scope: ContextScope;
    teamId?: string;
    agentId?: string;
    key: string;
    content?: string;
    data?: Record<string, unknown>;
    pinned?: boolean;
    source?: string;
  }): Observable<{ entry: ContextEntry }> {
    return this.http.post<{ entry: ContextEntry }>(this.url('/contexts'), body);
  }

  // -------------------------------------------------------------------------
  // Mistake / rule registry.
  // -------------------------------------------------------------------------
  listMistakes(filter: { teamId?: string; agentId?: string } = {}): Observable<{ mistakes: Mistake[] }> {
    const params: Record<string, string> = {};
    if (filter.teamId) params['teamId'] = filter.teamId;
    if (filter.agentId) params['agentId'] = filter.agentId;
    return this.http.get<{ mistakes: Mistake[] }>(this.url('/mistakes'), { params });
  }

  createMistake(body: {
    teamId: string;
    agentId?: string;
    scope: ContextScope;
    title: string;
    rule: string;
    description?: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }): Observable<{ mistake: Mistake }> {
    return this.http.post<{ mistake: Mistake }>(this.url('/mistakes'), body);
  }

  // -------------------------------------------------------------------------
  // Provider keys (BYOK) — secret never returned, only redacted preview.
  // -------------------------------------------------------------------------
  listProviderKeys(): Observable<{ keys: ProviderKeyRow[] }> {
    return this.http.get<{ keys: ProviderKeyRow[] }>(this.url('/provider-keys'));
  }

  createProviderKey(body: {
    provider: string;
    label: string;
    secret: string;
    teamId?: string;
    metadata?: Record<string, unknown>;
  }): Observable<{ key: ProviderKeyRow }> {
    return this.http.post<{ key: ProviderKeyRow }>(this.url('/provider-keys'), body);
  }

  deleteProviderKey(id: string): Observable<void> {
    return this.http.delete<void>(this.url(`/provider-keys/${id}`));
  }

  revealProviderKey(id: string): Observable<{ id: string; provider: string; label: string; preview: string; metadata: Record<string, unknown> }> {
    return this.http.get<any>(this.url(`/provider-keys/${id}/reveal`));
  }

  // -------------------------------------------------------------------------
  // Model routing.
  // -------------------------------------------------------------------------
  listRoutingRules(): Observable<{ rules: RoutingRule[] }> {
    return this.http.get<{ rules: RoutingRule[] }>(this.url('/model-routing'));
  }

  createRoutingRule(body: Partial<RoutingRule> & { scope: 'ORG' | 'TEAM' | 'AGENT'; useCase: string; provider: string; model: string }): Observable<{ rule: RoutingRule }> {
    return this.http.post<{ rule: RoutingRule }>(this.url('/model-routing'), body);
  }

  // -------------------------------------------------------------------------
  // MCP servers.
  // -------------------------------------------------------------------------
  listMcpServers(): Observable<{ servers: McpServerRow[] }> {
    return this.http.get<{ servers: McpServerRow[] }>(this.url('/mcp-servers'));
  }

  createMcpServer(body: any): Observable<{ server: McpServerRow }> {
    return this.http.post<{ server: McpServerRow }>(this.url('/mcp-servers'), body);
  }

  patchMcpServer(id: string, body: Record<string, unknown>): Observable<{ server: McpServerRow }> {
    return this.http.patch<{ server: McpServerRow }>(this.url(`/mcp-servers/${id}`), body);
  }

  // -------------------------------------------------------------------------
  // Orchestrator dispatch (BYOK + routing; pause-aware).
  // -------------------------------------------------------------------------
  dispatch(body: {
    teamId: string;
    agentId: string;
    prompt: string;
    useCase?: string;
    taskId?: string;
    activeFilePath?: string;
    activeFileContent?: string;
    selectedText?: string;
  }): Observable<{ outcome: string; provider: string; model: string; ruleId: string | null; text: string }> {
    return this.http.post<{ outcome: string; provider: string; model: string; ruleId: string | null; text: string }>(
      this.url('/dispatch'),
      body
    );
  }

  // -------------------------------------------------------------------------
  // Integrations.
  // -------------------------------------------------------------------------
  listIntegrations(): Observable<{ integrations: IntegrationRow[] }> {
    return this.http.get<{ integrations: IntegrationRow[] }>(this.url('/integrations'));
  }

  createIntegration(body: { kind: string; name: string; teamId?: string; config?: Record<string, unknown>; credentials?: Record<string, unknown> }): Observable<{ integration: IntegrationRow }> {
    return this.http.post<{ integration: IntegrationRow }>(this.url('/integrations'), body);
  }

  pingIntegration(id: string): Observable<{ ok: boolean; provider?: string; error?: unknown }> {
    return this.http.post<{ ok: boolean; provider?: string; error?: unknown }>(this.url(`/integrations/${id}/ping`), {});
  }

  // -------------------------------------------------------------------------
  // Autonomous runs + JSONL events + local runner
  // -------------------------------------------------------------------------
  listTeamRuns(teamId: string): Observable<{ runs: TeamRun[] }> {
    return this.http.get<{ runs: TeamRun[] }>(this.url(`/teams/${teamId}/runs`));
  }

  createTeamRun(
    teamId: string,
    body: {
      name?: string;
      objective: string;
      runMode?: TeamRunMode;
      maxSteps?: number;
      localRunnerId?: string;
      useJarvis?: boolean;
      metadata?: Record<string, unknown>;
    }
  ): Observable<{ run: TeamRun }> {
    return this.http.post<{ run: TeamRun }>(this.url(`/teams/${teamId}/runs`), body);
  }

  getTeamRun(runId: string): Observable<{ run: TeamRun; steps: unknown[]; agentRuns: unknown[] }> {
    return this.http.get<{ run: TeamRun; steps: unknown[]; agentRuns: unknown[] }>(
      this.url(`/team-runs/${runId}`)
    );
  }

  pauseTeamRun(runId: string): Observable<{ run: TeamRun }> {
    return this.http.post<{ run: TeamRun }>(this.url(`/team-runs/${runId}/pause`), {});
  }

  resumeTeamRun(runId: string): Observable<{ run: TeamRun }> {
    return this.http.post<{ run: TeamRun }>(this.url(`/team-runs/${runId}/resume`), {});
  }

  cancelTeamRun(runId: string): Observable<{ run: TeamRun }> {
    return this.http.post<{ run: TeamRun }>(this.url(`/team-runs/${runId}/cancel`), {});
  }

  stepTeamRun(runId: string, body?: Record<string, unknown>): Observable<{ run: TeamRun; step: unknown }> {
    return this.http.post<{ run: TeamRun; step: unknown }>(this.url(`/team-runs/${runId}/step`), body ?? {});
  }

  listTeamEvents(teamId: string, teamRunId?: string, limit = 100): Observable<{ events: TeamEventLogEntry[] }> {
    const params: Record<string, string> = { limit: String(limit) };
    if (teamRunId) params['teamRunId'] = teamRunId;
    return this.http.get<{ events: TeamEventLogEntry[] }>(this.url(`/teams/${teamId}/events`), { params });
  }

  appendTeamEvent(
    teamId: string,
    body: {
      eventType: string;
      summary: string;
      actorType?: string;
      actorName?: string;
      teamRunId?: string;
      agentId?: string;
      taskId?: string;
      jsonl?: Record<string, unknown>;
    }
  ): Observable<{ event: { id: string; sequence: number } }> {
    return this.http.post<{ event: { id: string; sequence: number } }>(
      this.url(`/teams/${teamId}/events`),
      body
    );
  }

  listAgentPrivateContexts(teamId: string): Observable<{ contexts: AgentPrivateContext[] }> {
    return this.http.get<{ contexts: AgentPrivateContext[] }>(this.url(`/teams/${teamId}/agent-contexts`));
  }

  listLocalRunners(): Observable<{ runners: LocalRunner[] }> {
    return this.http.get<{ runners: LocalRunner[] }>(this.url('/local-runners'));
  }

  createLocalRunnerPairingCode(name?: string): Observable<{ runner: LocalRunner; pairingCode: string }> {
    return this.http.post<{ runner: LocalRunner; pairingCode: string }>(
      this.url('/local-runners/pairing-code'),
      { name: name ?? 'Local Runner' }
    );
  }

  listLocalVendors(runnerId?: string): Observable<{ vendors: LocalVendorRef[] }> {
    const params: Record<string, string> = {};
    if (runnerId) params['runnerId'] = runnerId;
    return this.http.get<{ vendors: LocalVendorRef[] }>(this.url('/local-vendors'), { params });
  }

  previewModelRouting(body: {
    teamId: string;
    agentId?: string;
    useCase: string;
    executionMode?: string;
  }): Observable<{
    provider: string;
    model: string;
    source: string;
    keyMode: string;
    reason: string;
  }> {
    return this.http.post<{
      provider: string;
      model: string;
      source: string;
      keyMode: string;
      reason: string;
    }>(this.url('/model-routing/preview'), body);
  }

  // -------------------------------------------------------------------------
  // TCL engine (truth analytics for agent work).
  // -------------------------------------------------------------------------

  listTclLiveFeed(teamId?: string, since?: string, limit = 40): Observable<{
    analyses: TclAnalysisRow[];
    migrationRequired?: string;
  }> {
    const params: Record<string, string> = { limit: String(limit) };
    if (teamId) params['teamId'] = teamId;
    if (since) params['since'] = since;
    return this.http.get<{ analyses: TclAnalysisRow[]; migrationRequired?: string }>(
      this.url('/tcl/live-feed'),
      { params }
    );
  }

  listTeamTclAnalyses(teamId: string, limit = 50): Observable<{
    analyses: TclAnalysisRow[];
    migrationRequired?: string;
  }> {
    return this.http.get<{ analyses: TclAnalysisRow[]; migrationRequired?: string }>(
      this.url(`/teams/${teamId}/tcl/analyses`),
      { params: { limit: String(limit) } }
    );
  }

  getTclAnalysis(teamId: string, analysisId: string): Observable<{ analysis: TclAnalysisRow }> {
    return this.http.get<{ analysis: TclAnalysisRow }>(
      this.url(`/teams/${teamId}/tcl/analyses/${analysisId}`)
    );
  }

  analyzeWithTcl(
    teamId: string,
    body: {
      question: string;
      answer: string;
      sources?: Array<{ id: string; text: string; label?: string }>;
      agentId?: string;
      taskId?: string;
      agentRunId?: string;
      trigger?: string;
    }
  ): Observable<{ analysisId: string; report: StudioTclReport }> {
    return this.http.post<{ analysisId: string; report: StudioTclReport }>(
      this.url(`/teams/${teamId}/tcl/analyze`),
      body
    );
  }

  /**
   * Fetch-based SSE with Bearer auth (EventSource cannot set Authorization).
   * Returns abort function.
   */
  connectTclStream(
    onAnalysis: (payload: TclAnalysisRow & { id: string; team_id: string; status: string }) => void,
    teamId?: string
  ): () => void {
    const ac = new AbortController();
    const params = new URLSearchParams();
    if (teamId) params.set('teamId', teamId);
    const url = `${this.url('/tcl/stream')}?${params.toString()}`;
    const token = this.auth.getAccessTokenSync();
    const orgId =
      typeof window !== 'undefined' ? window.localStorage.getItem('activeOrgId') : null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (orgId) headers['X-Active-Org-Id'] = orgId;

    void (async () => {
      try {
        const res = await fetch(url, { headers, signal: ac.signal });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split('\n\n');
          buf = blocks.pop() ?? '';
          for (const block of blocks) {
            if (!block.includes('event: analysis')) continue;
            const line = block.split('\n').find((l) => l.startsWith('data: '));
            if (line) {
              try {
                onAnalysis(JSON.parse(line.slice(6)) as TclAnalysisRow & {
                  id: string;
                  team_id: string;
                  status: string;
                });
              } catch {
                /* ignore parse errors */
              }
            }
          }
        }
      } catch {
        /* aborted or network */
      }
    })();

    return () => ac.abort();
  }

  listTeamPatches(
    teamId: string,
    status?: string
  ): Observable<{ patches: PatchProposalRow[]; migrationRequired?: string }> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    return this.http.get<{ patches: PatchProposalRow[]; migrationRequired?: string }>(
      this.url(`/teams/${teamId}/patches`),
      { params }
    );
  }

  applyTeamPatch(
    teamId: string,
    patchId: string
  ): Observable<{ patch: PatchProposalRow; workspace: Record<string, string> }> {
    return this.http.post<{ patch: PatchProposalRow; workspace: Record<string, string> }>(
      this.url(`/teams/${teamId}/patches/${patchId}/apply`),
      {}
    );
  }

  updatePatchStatus(
    teamId: string,
    patchId: string,
    status: 'APPROVED' | 'REJECTED' | 'APPLIED' | 'SUPERSEDED'
  ): Observable<{ patch: PatchProposalRow }> {
    return this.http.patch<{ patch: PatchProposalRow }>(
      this.url(`/teams/${teamId}/patches/${patchId}`),
      { status }
    );
  }

  // -------------------------------------------------------------------------
  // Audit.
  // -------------------------------------------------------------------------
  listAuditEvents(teamId?: string, limit = 100): Observable<{ events: AuditEvent[] }> {
    const params: Record<string, string> = { limit: String(limit) };
    if (teamId) params['teamId'] = teamId;
    return this.http.get<{ events: AuditEvent[] }>(this.url('/audit-logs'), { params });
  }
}

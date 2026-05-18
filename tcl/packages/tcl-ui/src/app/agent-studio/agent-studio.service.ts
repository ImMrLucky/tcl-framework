import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Agent,
  AgentConfigVersion,
  AgentStudioSettings,
  AgentTeam,
  AuditEvent,
  AgentStudioSummary,
  TeamCommandCenter,
  PersonaTemplate,
  TemplatePackRow,
  AgentMarkdownFile,
  ContextEntry,
  ContextScope,
  IntegrationRow,
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
  constructor(private http: HttpClient) {}

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

  deleteAgent(agentId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/agents/${agentId}`));
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

  // -------------------------------------------------------------------------
  // Board + tasks.
  // -------------------------------------------------------------------------
  getBoard(teamId: string): Observable<{ board: KanbanBoard; tasks: Task[] }> {
    return this.http.get<{ board: KanbanBoard; tasks: Task[] }>(this.url(`/teams/${teamId}/board`));
  }

  createTask(teamId: string, body: CreateTaskPayload): Observable<{ task: Task }> {
    return this.http.post<{ task: Task }>(this.url(`/teams/${teamId}/tasks`), body);
  }

  updateTask(taskId: string, body: Partial<Task & { columnKey: string; assignedAgentId: string | null }>): Observable<{ task: Task }> {
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

  createReviewGate(taskId: string, gateType: ReviewGateType, requiredRole?: string): Observable<{ gate: ReviewGate }> {
    return this.http.post<{ gate: ReviewGate }>(this.url(`/tasks/${taskId}/review-gates`), { gateType, requiredRole });
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
  // Audit.
  // -------------------------------------------------------------------------
  listAuditEvents(teamId?: string, limit = 100): Observable<{ events: AuditEvent[] }> {
    const params: Record<string, string> = { limit: String(limit) };
    if (teamId) params['teamId'] = teamId;
    return this.http.get<{ events: AuditEvent[] }>(this.url('/audit-logs'), { params });
  }
}

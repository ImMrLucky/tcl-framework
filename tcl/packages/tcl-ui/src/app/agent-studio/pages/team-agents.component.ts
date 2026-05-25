import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatStepperModule } from '@angular/material/stepper';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { AgentStudioService } from '../agent-studio.service';
import { Agent, AgentMarkdownFile, PersonaTemplate, ProviderKeyRow, RoleTemplate } from '../agent-studio.types';
import {
  RemoveAgentDialogComponent,
  RemoveAgentDialogData,
} from './remove-agent-dialog.component';

const LLM_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'azure-openai', label: 'Azure OpenAI' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'groq', label: 'Groq' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
];

const PACK_KEYS = [
  { key: 'generic_agent_setup', label: 'Generic Agent Setup (default)' },
  { key: 'generic_software_delivery', label: 'Generic Software Delivery' },
  { key: 'bmad', label: 'BMAD Workflow Pack (optional)' },
  { key: 'scrum', label: 'Scrum Team' },
  { key: 'research', label: 'Research Team' },
  { key: 'qa_review', label: 'QA Review Team' },
  { key: 'security_review', label: 'Security Review Team' },
  { key: 'data_analysis', label: 'Data Analysis Team' },
  { key: 'customer_support', label: 'Customer Support' },
];

@Component({
  selector: 'app-team-agents',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatExpansionModule,
    MatSnackBarModule,
    MatStepperModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTooltipModule,
    MatMenuModule,
  ],
  template: `
    <section class="page">
      <header class="header">
        <div>
          <h2>Agents</h2>
          <p class="muted small">Specialists can be removed with <strong>Remove agent</strong> (Jarvis cannot).</p>
        </div>
        <button mat-flat-button color="primary" (click)="showForm = !showForm">
          <mat-icon>add</mat-icon>
          New agent
        </button>
      </header>

      <mat-card *ngIf="showForm" class="create-card">
        <mat-card-title>Create agent (generic setup)</mat-card-title>
        <mat-card-content>
          <mat-vertical-stepper [linear]="false">
            <mat-step label="Template pack & name">
              <p class="muted small">
                Agent Studio is generic: pick a <strong>workflow / template pack</strong>. BMAD is optional, not the default platform mode.
              </p>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Template pack</mat-label>
                <mat-select [(ngModel)]="templatePackKey">
                  <mat-option *ngFor="let p of packKeys" [value]="p.key">{{ p.label }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Agent name</mat-label>
                <input matInput [(ngModel)]="newName" />
              </mat-form-field>
            </mat-step>
            <mat-step label="Role & persona">
              <mat-form-field appearance="outline" class="full">
                <mat-label>Role template (job)</mat-label>
                <mat-select [(ngModel)]="newRoleKey" (selectionChange)="applyRoleDefaults()">
                  <mat-option [value]="null">— Custom —</mat-option>
                  <mat-option *ngFor="let r of roles" [value]="r.key">{{ r.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Persona template (style)</mat-label>
                <mat-select [(ngModel)]="personaTemplateKey">
                  <mat-option [value]="null">— None —</mat-option>
                  <mat-option *ngFor="let p of personas" [value]="p.key">{{ p.name }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Persona override (optional free text)</mat-label>
                <textarea matInput rows="3" [(ngModel)]="newPersona"></textarea>
              </mat-form-field>
              <mat-slide-toggle [(ngModel)]="newIsOrchestrator">Acts as Agent Manager / Orchestrator</mat-slide-toggle>
            </mat-step>
            <mat-step label="Files & create">
              <p class="muted small">
                On create, the server seeds all 12 Markdown files (<code>agent.md</code>, <code>persona.md</code>, <code>instructions.md</code>, …) with detailed role-aware content from the generic asset bundle.
                Dispatch composes prompts from those files after migration <code>050</code> is applied.
              </p>
              <div class="row">
                <button mat-button (click)="showForm = false">Cancel</button>
                <button mat-flat-button color="primary" [disabled]="!newName.trim() || creating" (click)="createAgent()">
                  {{ creating ? 'Creating…' : 'Create agent' }}
                </button>
              </div>
            </mat-step>
          </mat-vertical-stepper>
        </mat-card-content>
      </mat-card>

      <div *ngIf="!agents.length" class="empty">
        <mat-icon>smart_toy</mat-icon>
        <p>No agents yet. Add one above — start with the Agent Manager.</p>
      </div>

      <div class="grid">
        <mat-card *ngFor="let agent of agents" class="agent-card">
          <div class="agent-card-head">
            <div class="agent-title-block">
              <mat-card-title>
                {{ agent.name }}
                <mat-chip *ngIf="isOrchestratorAgent(agent)" color="primary" selected>orchestrator</mat-chip>
                <mat-chip *ngIf="agent.paused_at" color="warn" selected>paused</mat-chip>
              </mat-card-title>
              <mat-card-subtitle *ngIf="agent.role_template_key">{{ agent.role_template_key }}</mat-card-subtitle>
            </div>
            <button mat-icon-button [matMenuTriggerFor]="agentMenu" aria-label="Agent actions">
              <mat-icon>more_vert</mat-icon>
            </button>
            <mat-menu #agentMenu="matMenu">
              <button mat-menu-item (click)="openConfig(agent)">
                <mat-icon>tune</mat-icon>
                <span>Config &amp; files</span>
              </button>
              <button mat-menu-item *ngIf="canRemoveAgent(agent)" (click)="confirmRemove(agent)">
                <mat-icon color="warn">delete</mat-icon>
                <span>Remove agent</span>
              </button>
            </mat-menu>
          </div>
          <mat-card-content>
            <p class="muted persona" *ngIf="agent.persona">{{ agent.persona }}</p>
            <div class="runtime">
              <span class="runtime-label">Runtime</span>
              <mat-chip class="tiny">{{ agent.status }}</mat-chip>
              <mat-chip *ngIf="modelSummaryByAgent[agent.id]" class="tiny model-chip">
                {{ modelSummaryByAgent[agent.id]!.provider }}/{{ modelSummaryByAgent[agent.id]!.model }}
              </mat-chip>
              <mat-chip *ngIf="!modelSummaryByAgent[agent.id]" class="tiny warn-chip">no model</mat-chip>
              <mat-chip *ngIf="isOrchestratorAgent(agent)" class="tiny">Jarvis · orchestrate</mat-chip>
              <span class="muted small" *ngIf="agent.paused_at">Blocked: team/agent pause</span>
            </div>
            <mat-chip-set *ngIf="agent.capabilities?.length">
              <mat-chip *ngFor="let c of agent.capabilities">{{ c }}</mat-chip>
            </mat-chip-set>
          </mat-card-content>
          <mat-card-actions class="agent-actions">
            <button mat-stroked-button *ngIf="!agent.paused_at" (click)="pause(agent)">
              <mat-icon>pause</mat-icon> Pause
            </button>
            <button mat-stroked-button color="primary" *ngIf="agent.paused_at" (click)="resume(agent)">
              <mat-icon>play_arrow</mat-icon> Resume
            </button>
            <button mat-stroked-button (click)="openConfig(agent)">
              <mat-icon>tune</mat-icon> Config
            </button>
            <button
              mat-flat-button
              color="warn"
              class="remove-btn"
              *ngIf="canRemoveAgent(agent)"
              (click)="confirmRemove(agent)"
              [disabled]="removingAgentId === agent.id"
            >
              <mat-icon>delete</mat-icon>
              {{ removingAgentId === agent.id ? 'Removing…' : 'Remove agent' }}
            </button>
          </mat-card-actions>

          <div *ngIf="expandedAgentId === agent.id" class="config-panel">
            <mat-tab-group animationDuration="0ms" (selectedIndexChange)="onConfigTabChange(agent, $event)">
              <mat-tab label="Markdown files">
                <div class="tab-body">
                  <div class="row actions" *ngIf="loadingFiles">
                    <mat-spinner diameter="24"></mat-spinner>
                    <span class="muted">Loading files…</span>
                  </div>
                  <div class="row actions" *ngIf="!loadingFiles">
                    <button mat-stroked-button (click)="loadFiles(agent)">
                      <mat-icon>refresh</mat-icon> Refresh
                    </button>
                    <button mat-stroked-button (click)="seedFiles(agent)" [disabled]="seedingFiles">
                      {{ seedingFiles ? 'Seeding…' : 'Seed / upgrade all .md files' }}
                    </button>
                    <button mat-button (click)="previewSelected(agent)" [disabled]="!selectedFile">
                      <mat-icon>visibility</mat-icon> Preview composed prompt
                    </button>
                  </div>
                  <p class="muted small" *ngIf="filesByAgent[agent.id] && !filesByAgent[agent.id]!.length">
                    No markdown files yet. Click <strong>Seed / repair files</strong> (requires migration 050).
                  </p>
                  <div class="file-editor" *ngIf="filesByAgent[agent.id]?.length">
                    <mat-form-field appearance="outline" class="file-select">
                      <mat-label>File</mat-label>
                      <mat-select [ngModel]="selectedFileId" (ngModelChange)="onSelectFile(agent, $event)">
                        <mat-option *ngFor="let f of filesByAgent[agent.id]" [value]="f.id">
                          {{ f.file_path }}
                          <span class="muted" *ngIf="!f.markdown?.trim()"> (empty)</span>
                        </mat-option>
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field appearance="outline" class="full">
                      <mat-label>{{ selectedFile?.file_path || 'markdown' }}</mat-label>
                      <textarea matInput rows="16" [(ngModel)]="markdownDraft" [disabled]="!selectedFile"></textarea>
                    </mat-form-field>
                    <div class="row">
                      <button
                        mat-flat-button
                        color="primary"
                        [disabled]="!selectedFile || savingMarkdown"
                        (click)="saveMarkdown(agent)"
                      >
                        {{ savingMarkdown ? 'Saving…' : 'Save markdown' }}
                      </button>
                    </div>
                  </div>
                </div>
              </mat-tab>
              <mat-tab label="Model &amp; API key">
                <div class="tab-body">
                  <p class="muted small">
                    Assign a <strong>vendor</strong>, <strong>model</strong>, and cloud BYOK key for this agent.
                    {{ isOrchestratorAgent(agent) ? 'Jarvis uses this for LLM planning and orchestration.' : 'Specialists use this for chat, code, and dispatch.' }}
                    Add keys in <a routerLink="/agent-studio/settings">Studio settings</a>.
                  </p>
                  <div class="row actions" *ngIf="loadingModelConfig">
                    <mat-spinner diameter="24"></mat-spinner>
                    <span class="muted">Loading model config…</span>
                  </div>
                  <ng-container *ngIf="!loadingModelConfig">
                    <mat-form-field appearance="outline" class="full">
                      <mat-label>Provider</mat-label>
                      <mat-select [(ngModel)]="modelDraft(agent).provider" (selectionChange)="onModelProviderChange(agent)">
                        <mat-option *ngFor="let p of llmProviders" [value]="p.value">{{ p.label }}</mat-option>
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field appearance="outline" class="full">
                      <mat-label>Model</mat-label>
                      <input matInput [(ngModel)]="modelDraft(agent).model" placeholder="e.g. gpt-4o-mini, claude-sonnet-4-20250514" />
                    </mat-form-field>
                    <mat-form-field appearance="outline" class="full">
                      <mat-label>Provider key (BYOK)</mat-label>
                      <mat-select [(ngModel)]="modelDraft(agent).providerKeyId">
                        <mat-option [value]="null">— None —</mat-option>
                        <mat-option *ngFor="let k of keysForProvider(modelDraft(agent).provider)" [value]="k.id">
                          {{ k.label }} ({{ k.provider }})
                        </mat-option>
                      </mat-select>
                    </mat-form-field>
                    <p class="muted small" *ngIf="!providerKeys.length">
                      No cloud keys yet — add one under Studio settings → Provider keys.
                    </p>
                    <div class="row">
                      <button
                        mat-flat-button
                        color="primary"
                        [disabled]="savingModelConfig || !modelDraft(agent).provider || !modelDraft(agent).model"
                        (click)="saveModelConfig(agent)"
                      >
                        {{ savingModelConfig ? 'Saving…' : 'Save model & key' }}
                      </button>
                    </div>
                  </ng-container>
                </div>
              </mat-tab>
              <mat-tab label="Runtime config (JSON)">
                <div class="tab-body">
                  <p class="muted small">Optional runtime overrides (model routing, feature flags). Prompt text comes from Markdown files.</p>
                  <mat-form-field appearance="outline" class="full">
                    <mat-label>config (JSON)</mat-label>
                    <textarea matInput rows="10" [(ngModel)]="configDraft"></textarea>
                  </mat-form-field>
                  <button mat-flat-button color="primary" (click)="publishConfig(agent)">Publish new version</button>
                </div>
              </mat-tab>
            </mat-tab-group>
          </div>
        </mat-card>
      </div>
    </section>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
      }
      .header h2 {
        margin: 0 0 4px;
      }
      .full {
        width: 100%;
      }
      .create-card {
        background: #fff;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
      }
      .agent-card {
        background: #fff;
        border: 1px solid #e2e8f0;
      }
      .agent-card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 16px 16px 0;
      }
      .agent-title-block {
        flex: 1;
        min-width: 0;
      }
      .agent-card-head mat-card-title,
      .agent-card-head mat-card-subtitle {
        padding: 0;
      }
      .persona {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .runtime {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin: 8px 0;
      }
      .runtime-label {
        font-size: 12px;
        color: #666;
        margin-right: 4px;
      }
      .model-chip {
        background: #e8f4fd !important;
      }
      .warn-chip {
        background: #fff3e0 !important;
      }
      .agent-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 8px 12px 16px !important;
      }
      .remove-btn {
        margin-left: auto;
        font-weight: 600;
      }
      .agent-card mat-card-title {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .config-panel {
        margin-top: 12px;
        padding: 8px 0 0;
        border-top: 1px solid #eee;
      }
      .tab-body {
        padding: 12px 0;
      }
      .actions {
        margin-bottom: 12px;
        align-items: center;
      }
      .file-select {
        width: 100%;
        max-width: 360px;
      }
      .file-editor {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .empty {
        text-align: center;
        padding: 64px 16px;
        color: #888;
      }
      .empty mat-icon {
        font-size: 48px;
        height: 48px;
        width: 48px;
      }
      .muted {
        color: #666;
      }
      .small {
        font-size: 13px;
      }
      .row {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }
      .file-list {
        list-style: none;
        padding: 0;
        margin: 8px 0 0;
      }
      .file-list li {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 4px 0;
      }
    `,
  ],
})
export class TeamAgentsComponent implements OnInit {
  agents: Agent[] = [];
  roles: RoleTemplate[] = [];
  personas: PersonaTemplate[] = [];
  packKeys = PACK_KEYS;
  llmProviders = LLM_PROVIDERS;
  providerKeys: ProviderKeyRow[] = [];
  showForm = false;
  newName = '';
  newRoleKey: string | null = null;
  personaTemplateKey: string | null = null;
  templatePackKey = 'generic_agent_setup';
  newPersona = '';
  newIsOrchestrator = false;
  creating = false;

  expandedAgentId: string | null = null;
  configDraft = '{}';
  filesByAgent: Record<string, AgentMarkdownFile[]> = {};
  selectedFileId: string | null = null;
  selectedFile: AgentMarkdownFile | null = null;
  markdownDraft = '';
  loadingFiles = false;
  savingMarkdown = false;
  seedingFiles = false;
  configsLoadedFor: Record<string, boolean> = {};
  modelConfigLoadedFor: Record<string, boolean> = {};
  modelSummaryByAgent: Record<string, { provider: string; model: string } | null> = {};
  modelDraftByAgent: Record<string, { provider: string; model: string; providerKeyId: string | null }> = {};
  loadingModelConfig = false;
  savingModelConfig = false;
  removingAgentId: string | null = null;

  private teamId!: string;

  constructor(
    private route: ActivatedRoute,
    private studio: AgentStudioService,
    private snack: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh();
    this.studio.listRoleTemplates().subscribe({ next: (r) => (this.roles = r.templates) });
    this.studio.listPersonaTemplates().subscribe({ next: (r) => (this.personas = r.templates) });
    this.studio.listProviderKeys().subscribe({ next: (r) => (this.providerKeys = r.keys) });
  }

  modelDraft(agent: Agent): { provider: string; model: string; providerKeyId: string | null } {
    if (!this.modelDraftByAgent[agent.id]) {
      this.modelDraftByAgent[agent.id] = { provider: 'openai', model: 'gpt-4o-mini', providerKeyId: null };
    }
    return this.modelDraftByAgent[agent.id];
  }

  keysForProvider(provider: string): ProviderKeyRow[] {
    const p = provider.toLowerCase();
    return this.providerKeys.filter((k) => k.provider.toLowerCase() === p && k.is_active);
  }

  refresh(): void {
    this.studio.listAgents(this.teamId).subscribe({
      next: (r) => {
        this.agents = r.agents;
        this.loadModelSummaries(r.agents);
      },
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load agents', 'OK', { duration: 4000 }),
    });
  }

  private loadModelSummaries(agents: Agent[]): void {
    for (const agent of agents) {
      this.studio.getAgentModelConfig(agent.id).subscribe({
        next: (r) => {
          const cfg = r.config;
          if (cfg.provider && cfg.model && cfg.providerKeyId) {
            this.modelSummaryByAgent = {
              ...this.modelSummaryByAgent,
              [agent.id]: { provider: cfg.provider, model: cfg.model },
            };
          } else {
            this.modelSummaryByAgent = { ...this.modelSummaryByAgent, [agent.id]: null };
          }
        },
        error: () => {
          this.modelSummaryByAgent = { ...this.modelSummaryByAgent, [agent.id]: null };
        },
      });
    }
  }

  isOrchestratorAgent(agent: Agent): boolean {
    return !!(
      agent.is_orchestrator ||
      agent.role_template_key === 'agent_manager' ||
      agent.name?.trim().toLowerCase() === 'jarvis'
    );
  }

  canRemoveAgent(agent: Agent): boolean {
    return !this.isOrchestratorAgent(agent);
  }

  applyRoleDefaults(): void {
    if (!this.newRoleKey) return;
    const role = this.roles.find((r) => r.key === this.newRoleKey);
    if (!role) return;
    if (!this.newPersona) this.newPersona = role.defaultPersona;
    if (role.isOrchestrator) this.newIsOrchestrator = true;
    if (!this.newName) this.newName = role.name;
  }

  createAgent(): void {
    if (!this.newName.trim()) return;
    this.creating = true;
    const role = this.roles.find((r) => r.key === this.newRoleKey);
    this.studio
      .createAgent(this.teamId, {
        name: this.newName.trim(),
        roleTemplateKey: this.newRoleKey || undefined,
        isOrchestrator: this.newIsOrchestrator,
        persona: this.newPersona.trim() || undefined,
        capabilities: role?.defaultCapabilities ?? [],
        tools: role?.defaultTools ?? [],
        templatePackKey: this.templatePackKey,
        personaTemplateKey: this.personaTemplateKey || undefined,
        generateAgentFiles: true,
      })
      .subscribe({
        next: () => {
          this.creating = false;
          this.showForm = false;
          this.newName = '';
          this.newPersona = '';
          this.newRoleKey = null;
          this.personaTemplateKey = null;
          this.templatePackKey = 'generic_agent_setup';
          this.newIsOrchestrator = false;
          this.refresh();
        },
        error: (err) => {
          this.creating = false;
          this.snack.open(err?.error?.error || 'Create failed', 'OK', { duration: 4000 });
        },
      });
  }

  loadFiles(agent: Agent, selectFirst = false): void {
    this.loadingFiles = true;
    this.studio.listAgentMarkdownFiles(agent.id).subscribe({
      next: (r) => {
        this.loadingFiles = false;
        this.filesByAgent = { ...this.filesByAgent, [agent.id]: r.files };
        if (selectFirst && r.files.length) {
          this.onSelectFile(agent, r.files[0].id);
        } else if (this.selectedFileId) {
          const still = r.files.find((f) => f.id === this.selectedFileId);
          if (still) this.onSelectFile(agent, still.id);
        }
      },
      error: () => {
        this.loadingFiles = false;
        this.snack.open('Could not load files (migration 050 applied?)', 'OK', { duration: 4000 });
      },
    });
  }

  onSelectFile(agent: Agent, fileId: string): void {
    const f = this.filesByAgent[agent.id]?.find((x) => x.id === fileId) ?? null;
    this.selectedFileId = fileId;
    this.selectedFile = f;
    this.markdownDraft = f?.markdown ?? '';
  }

  saveMarkdown(agent: Agent): void {
    if (!this.selectedFile) return;
    this.savingMarkdown = true;
    this.studio
      .updateAgentMarkdownFile(agent.id, this.selectedFile.id, {
        markdown: this.markdownDraft,
        changeNote: 'edited in Agents UI',
      })
      .subscribe({
        next: (r) => {
          this.savingMarkdown = false;
          this.selectedFile = r.file;
          const list = this.filesByAgent[agent.id] ?? [];
          this.filesByAgent = {
            ...this.filesByAgent,
            [agent.id]: list.map((x) => (x.id === r.file.id ? r.file : x)),
          };
          this.snack.open('Markdown saved.', 'OK', { duration: 3000 });
        },
        error: (err) => {
          this.savingMarkdown = false;
          this.snack.open(err?.error?.error || 'Save failed', 'OK', { duration: 4000 });
        },
      });
  }

  seedFiles(agent: Agent): void {
    this.seedingFiles = true;
    this.studio.seedAgentMarkdownFiles(agent.id).subscribe({
      next: (r) => {
        this.seedingFiles = false;
        this.snack.open(
          `Files: ${r.inserted} added, ${r.repaired} repaired, ${r.skipped} unchanged`,
          'OK',
          { duration: 5000 }
        );
        this.loadFiles(agent, true);
      },
      error: (err) => {
        this.seedingFiles = false;
        this.snack.open(err?.error?.error || 'Seed failed', 'OK', { duration: 4000 });
      },
    });
  }

  previewSelected(agent: Agent): void {
    if (!this.selectedFile) return;
    this.preview(agent, this.selectedFile);
  }

  preview(agent: Agent, _f: AgentMarkdownFile): void {
    this.studio.previewAgentPrompt(agent.id, { userPrompt: 'Hello — summarize your operating context.' }).subscribe({
      next: (r) =>
        this.snack.open(`Preview length ${r.composedPrompt.length} chars (${r.filesUsed.length} files)`, 'OK', {
          duration: 5000,
        }),
      error: (err) => this.snack.open(err?.error?.error || 'Preview failed', 'OK', { duration: 4000 }),
    });
  }

  pause(agent: Agent): void {
    const reason = window.prompt('Reason for pausing this agent? (optional)') ?? undefined;
    this.studio.pauseAgent(agent.id, reason).subscribe({ next: () => this.refresh() });
  }

  resume(agent: Agent): void {
    this.studio.resumeAgent(agent.id).subscribe({ next: () => this.refresh() });
  }

  confirmRemove(agent: Agent): void {
    if (!this.canRemoveAgent(agent)) {
      this.snack.open('Jarvis cannot be removed — pause the orchestrator instead.', 'OK', { duration: 5000 });
      return;
    }
    this.studio.getAgentRemovalImpact(agent.id).subscribe({
      next: (r) => {
        const ref = this.dialog.open(RemoveAgentDialogComponent, {
          width: '480px',
          data: { impact: r.impact } satisfies RemoveAgentDialogData,
        });
        ref.afterClosed().subscribe((result) => {
          if (!result?.confirmed) return;
          this.removingAgentId = agent.id;
          this.studio
            .deleteAgent(agent.id, {
              taskDisposition: result.taskDisposition,
            })
            .subscribe({
              next: (deleted) => {
                this.removingAgentId = null;
                if (this.expandedAgentId === agent.id) {
                  this.expandedAgentId = null;
                }
                const msg =
                  deleted.tasksUpdated > 0
                    ? deleted.disposition === 'jarvis'
                      ? `Removed ${deleted.agentName}. ${deleted.tasksUpdated} task(s) assigned to Jarvis.`
                      : `Removed ${deleted.agentName}. ${deleted.tasksUpdated} task(s) unassigned.`
                    : `Removed ${deleted.agentName}.`;
                this.snack.open(msg, 'OK', { duration: 6000 });
                this.refresh();
              },
              error: (err) => {
                this.removingAgentId = null;
                this.snack.open(err?.error?.error || 'Remove failed', 'OK', { duration: 5000 });
              },
            });
        });
      },
      error: (err) => {
        this.snack.open(err?.error?.error || 'Could not load removal details', 'OK', { duration: 4000 });
      },
    });
  }

  openConfig(agent: Agent): void {
    if (this.expandedAgentId === agent.id) {
      this.expandedAgentId = null;
      this.selectedFile = null;
      this.selectedFileId = null;
      this.markdownDraft = '';
      return;
    }
    this.expandedAgentId = agent.id;
    this.selectedFile = null;
    this.selectedFileId = null;
    this.markdownDraft = '';
    this.loadFiles(agent, true);
  }

  onConfigTabChange(agent: Agent, tabIndex: number): void {
    if (tabIndex === 1) {
      this.loadModelConfig(agent);
    }
    if (tabIndex === 2) {
      this.loadAgentConfigs(agent);
    }
  }

  loadModelConfig(agent: Agent): void {
    if (this.modelConfigLoadedFor[agent.id]) return;
    this.loadingModelConfig = true;
    this.studio.getAgentModelConfig(agent.id).subscribe({
      next: (r) => {
        this.loadingModelConfig = false;
        this.modelConfigLoadedFor = { ...this.modelConfigLoadedFor, [agent.id]: true };
        this.modelDraftByAgent[agent.id] = {
          provider: r.config.provider || 'openai',
          model: r.config.model || 'gpt-4o-mini',
          providerKeyId: r.config.providerKeyId ?? null,
        };
        if (r.config.provider && r.config.model && r.config.providerKeyId) {
          this.modelSummaryByAgent = {
            ...this.modelSummaryByAgent,
            [agent.id]: { provider: r.config.provider, model: r.config.model },
          };
        }
      },
      error: (err) => {
        this.loadingModelConfig = false;
        this.snack.open(err?.error?.error || 'Failed to load model config', 'OK', { duration: 4000 });
      },
    });
  }

  onModelProviderChange(agent: Agent): void {
    const draft = this.modelDraft(agent);
    const keys = this.keysForProvider(draft.provider);
    if (draft.providerKeyId && !keys.some((k) => k.id === draft.providerKeyId)) {
      draft.providerKeyId = keys[0]?.id ?? null;
    }
  }

  saveModelConfig(agent: Agent): void {
    const draft = this.modelDraft(agent);
    this.savingModelConfig = true;
    this.studio
      .setAgentModelConfig(agent.id, {
        provider: draft.provider,
        model: draft.model.trim(),
        providerKeyId: draft.providerKeyId,
      })
      .subscribe({
        next: (r) => {
          this.savingModelConfig = false;
          this.modelConfigLoadedFor = { ...this.modelConfigLoadedFor, [agent.id]: true };
          if (r.config.providerKeyId) {
            this.modelSummaryByAgent = {
              ...this.modelSummaryByAgent,
              [agent.id]: { provider: r.config.provider, model: r.config.model },
            };
          } else {
            this.modelSummaryByAgent = { ...this.modelSummaryByAgent, [agent.id]: null };
          }
          this.snack.open('Model & key saved for this agent.', 'OK', { duration: 3000 });
        },
        error: (err) => {
          this.savingModelConfig = false;
          this.snack.open(err?.error?.error || 'Save failed', 'OK', { duration: 4000 });
        },
      });
  }

  loadAgentConfigs(agent: Agent): void {
    if (this.configsLoadedFor[agent.id]) return;
    this.studio.listAgentConfigs(agent.id).subscribe({
      next: (r) => {
        this.configsLoadedFor = { ...this.configsLoadedFor, [agent.id]: true };
        const active = r.configs.find((c) => c.is_active);
        this.configDraft = JSON.stringify(active?.config ?? {}, null, 2);
      },
      error: (err) => {
        const msg = err?.error?.error || err?.message || 'Failed to load config';
        if (err?.status === 401) {
          this.snack.open('Session expired — sign in again to edit runtime config.', 'OK', { duration: 5000 });
        } else {
          this.snack.open(msg, 'OK', { duration: 4000 });
        }
        this.configDraft = '{}';
      },
    });
  }

  publishConfig(agent: Agent): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(this.configDraft);
    } catch {
      this.snack.open('Invalid JSON', 'OK', { duration: 4000 });
      return;
    }
    this.studio.publishAgentConfig(agent.id, parsed).subscribe({
      next: () => this.snack.open('Config published.', 'OK', { duration: 3000 }),
      error: (err) => this.snack.open(err?.error?.error || 'Publish failed', 'OK', { duration: 4000 }),
    });
  }
}

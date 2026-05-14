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
import { AgentStudioService } from '../agent-studio.service';
import { Agent, AgentMarkdownFile, PersonaTemplate, RoleTemplate } from '../agent-studio.types';

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
  ],
  template: `
    <section class="page">
      <header class="header">
        <h2>Agents</h2>
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
                On create, the server seeds editable Markdown files (<code>agent.md</code>, <code>persona.md</code>, …) from the generic asset bundle.
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
          <mat-card-title>
            {{ agent.name }}
            <mat-chip *ngIf="agent.is_orchestrator" color="primary" selected>orchestrator</mat-chip>
            <mat-chip *ngIf="agent.paused_at" color="warn" selected>paused</mat-chip>
          </mat-card-title>
          <mat-card-subtitle *ngIf="agent.role_template_key">{{ agent.role_template_key }}</mat-card-subtitle>
          <mat-card-content>
            <p class="muted" *ngIf="agent.persona">{{ agent.persona }}</p>
            <mat-chip-set *ngIf="agent.capabilities?.length">
              <mat-chip *ngFor="let c of agent.capabilities">{{ c }}</mat-chip>
            </mat-chip-set>
          </mat-card-content>
          <mat-card-actions>
            <button mat-button color="warn" *ngIf="!agent.paused_at" (click)="pause(agent)">
              <mat-icon>pause</mat-icon> Pause
            </button>
            <button mat-button color="accent" *ngIf="agent.paused_at" (click)="resume(agent)">
              <mat-icon>play_arrow</mat-icon> Resume
            </button>
            <button mat-button (click)="openConfig(agent)">
              <mat-icon>tune</mat-icon> Config
            </button>
          </mat-card-actions>

          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <mat-panel-title>Markdown files</mat-panel-title>
            </mat-expansion-panel-header>
            <button mat-stroked-button (click)="loadFiles(agent)">Refresh file list</button>
            <ul class="file-list" *ngIf="filesByAgent[agent.id]?.length">
              <li *ngFor="let f of filesByAgent[agent.id]">
                <strong>{{ f.file_path }}</strong>
                <span class="muted">{{ f.file_type }}</span>
                <button mat-button (click)="preview(agent, f)">Preview prompt</button>
              </li>
            </ul>
            <p class="muted" *ngIf="filesByAgent[agent.id] && !filesByAgent[agent.id]!.length">No files yet (run DB migration 050 and recreate agent).</p>
          </mat-expansion-panel>

          <mat-expansion-panel *ngIf="expandedAgentId === agent.id" class="config-panel">
            <mat-expansion-panel-header>
              <mat-panel-title>Active config (JSON)</mat-panel-title>
            </mat-expansion-panel-header>
            <mat-form-field appearance="outline" class="full">
              <mat-label>config (JSON)</mat-label>
              <textarea matInput rows="10" [(ngModel)]="configDraft"></textarea>
            </mat-form-field>
            <button mat-flat-button color="primary" (click)="publishConfig(agent)">Publish new version</button>
          </mat-expansion-panel>
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
        align-items: center;
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
      }
      .agent-card mat-card-title {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .config-panel {
        margin-top: 12px;
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

  private teamId!: string;

  constructor(private route: ActivatedRoute, private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh();
    this.studio.listRoleTemplates().subscribe({ next: (r) => (this.roles = r.templates) });
    this.studio.listPersonaTemplates().subscribe({ next: (r) => (this.personas = r.templates) });
  }

  refresh(): void {
    this.studio.listAgents(this.teamId).subscribe({
      next: (r) => (this.agents = r.agents),
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load agents', 'OK', { duration: 4000 }),
    });
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

  loadFiles(agent: Agent): void {
    this.studio.listAgentMarkdownFiles(agent.id).subscribe({
      next: (r) => (this.filesByAgent = { ...this.filesByAgent, [agent.id]: r.files }),
      error: () => this.snack.open('Could not load files (migration 050 applied?)', 'OK', { duration: 4000 }),
    });
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

  openConfig(agent: Agent): void {
    if (this.expandedAgentId === agent.id) {
      this.expandedAgentId = null;
      return;
    }
    this.expandedAgentId = agent.id;
    this.studio.listAgentConfigs(agent.id).subscribe({
      next: (r) => {
        const active = r.configs.find((c) => c.is_active);
        this.configDraft = JSON.stringify(active?.config ?? {}, null, 2);
      },
      error: () => (this.configDraft = '{}'),
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

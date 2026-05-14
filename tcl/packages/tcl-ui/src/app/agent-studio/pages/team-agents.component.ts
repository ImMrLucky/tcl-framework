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
import { AgentStudioService } from '../agent-studio.service';
import { Agent, RoleTemplate } from '../agent-studio.types';

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
        <mat-card-title>Create agent</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="newName" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Role template</mat-label>
            <mat-select [(ngModel)]="newRoleKey" (selectionChange)="applyRoleDefaults()">
              <mat-option [value]="null">— Custom —</mat-option>
              <mat-option *ngFor="let r of roles" [value]="r.key">{{ r.name }}</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Persona</mat-label>
            <textarea matInput rows="3" [(ngModel)]="newPersona"></textarea>
          </mat-form-field>
          <mat-slide-toggle [(ngModel)]="newIsOrchestrator">Acts as Agent Manager / Orchestrator</mat-slide-toggle>
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-button (click)="showForm = false">Cancel</button>
          <button mat-flat-button color="primary" [disabled]="!newName.trim() || creating" (click)="createAgent()">
            {{ creating ? 'Creating…' : 'Create agent' }}
          </button>
        </mat-card-actions>
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

          <mat-expansion-panel *ngIf="expandedAgentId === agent.id" class="config-panel">
            <mat-expansion-panel-header>
              <mat-panel-title>Active config (JSON)</mat-panel-title>
            </mat-expansion-panel-header>
            <mat-form-field appearance="outline" class="full">
              <mat-label>config (JSON)</mat-label>
              <textarea matInput rows="10" [(ngModel)]="configDraft"></textarea>
            </mat-form-field>
            <button mat-flat-button color="primary" (click)="publishConfig(agent)">
              Publish new version
            </button>
          </mat-expansion-panel>
        </mat-card>
      </div>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .header { display: flex; justify-content: space-between; align-items: center; }
      .full { width: 100%; }
      .create-card { background: #fff; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
      .agent-card { background: #fff; }
      .agent-card mat-card-title { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .config-panel { margin-top: 12px; }
      .empty { text-align: center; padding: 64px 16px; color: #888; }
      .empty mat-icon { font-size: 48px; height: 48px; width: 48px; }
      .muted { color: #666; }
    `,
  ],
})
export class TeamAgentsComponent implements OnInit {
  agents: Agent[] = [];
  roles: RoleTemplate[] = [];
  showForm = false;
  newName = '';
  newRoleKey: string | null = null;
  newPersona = '';
  newIsOrchestrator = false;
  creating = false;

  expandedAgentId: string | null = null;
  configDraft = '{}';

  private teamId!: string;

  constructor(private route: ActivatedRoute, private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh();
    this.studio.listRoleTemplates().subscribe({ next: (r) => (this.roles = r.templates) });
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
      })
      .subscribe({
        next: () => {
          this.creating = false;
          this.showForm = false;
          this.newName = '';
          this.newPersona = '';
          this.newRoleKey = null;
          this.newIsOrchestrator = false;
          this.refresh();
        },
        error: (err) => {
          this.creating = false;
          this.snack.open(err?.error?.error || 'Create failed', 'OK', { duration: 4000 });
        },
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
    } catch (err) {
      this.snack.open('Invalid JSON', 'OK', { duration: 4000 });
      return;
    }
    this.studio.publishAgentConfig(agent.id, parsed).subscribe({
      next: () => this.snack.open('Config published.', 'OK', { duration: 3000 }),
      error: (err) => this.snack.open(err?.error?.error || 'Publish failed', 'OK', { duration: 4000 }),
    });
  }
}

import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatExpansionModule } from '@angular/material/expansion';
import { AgentStudioService } from '../agent-studio.service';
import {
  AgentTeam,
  TeamBoxCatalogEntry,
  TeamBoxRecommendation,
  WorkflowTemplate,
} from '../agent-studio.types';

@Component({
  selector: 'app-teams-list',
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
    MatCheckboxModule,
    MatSnackBarModule,
    MatExpansionModule,
  ],
  template: `
    <section class="page">
      <header class="header">
        <h2>Teams</h2>
        <p class="muted intro">
          Pick a <strong>team in a box</strong> — we provision Jarvis, specialists, and config files. Add work, then
          <strong>Start Working</strong>.
        </p>
      </header>

      <mat-card class="brainstorm-card">
        <mat-card-title>Describe your app or goals</mat-card-title>
        <mat-card-subtitle>We recommend a team type and how Jarvis should break down work (spec vs stories).</mat-card-subtitle>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>What do you want to build or accomplish?</mat-label>
            <textarea matInput rows="3" [(ngModel)]="brainstormIdea" placeholder="e.g. A mobile app for field technicians…"></textarea>
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Requirements & constraints (optional)</mat-label>
            <textarea matInput rows="2" [(ngModel)]="brainstormRequirements"></textarea>
          </mat-form-field>
          <button mat-stroked-button color="primary" (click)="runRecommend()" [disabled]="!brainstormIdea.trim() || recommending">
            {{ recommending ? 'Analyzing…' : 'Recommend team' }}
          </button>
          <div class="recommendation" *ngIf="recommendation as rec">
            <p>
              <strong>{{ rec.teamBoxName }}</strong>
              <mat-chip>{{ rec.confidence }} confidence</mat-chip>
              <mat-chip>{{ rec.deliveryMode === 'SPEC_DRIVEN' ? 'Spec-driven' : 'Task-driven' }}</mat-chip>
            </p>
            <p class="muted">{{ rec.rationale }}</p>
            <button mat-flat-button color="primary" (click)="useRecommendation(rec)">Use this team setup</button>
          </div>
        </mat-card-content>
      </mat-card>

      <div class="box-grid" *ngIf="boxes.length">
        <mat-card
          *ngFor="let box of boxes"
          class="box-card"
          [class.selected]="selectedBoxKey === box.key"
          (click)="selectBox(box)"
        >
          <mat-icon class="box-icon">{{ box.icon }}</mat-icon>
          <h3>{{ box.name }}</h3>
          <p class="muted">{{ box.description }}</p>
          <p class="meta muted">{{ box.agentRoleCount }} specialists + Jarvis</p>
        </mat-card>
      </div>

      <mat-card *ngIf="selectedBox" class="wizard-card">
        <mat-card-title>Create: {{ selectedBox.name }}</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Team name</mat-label>
            <input matInput [(ngModel)]="newName" placeholder="e.g. Mobile Checkout Squad" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full">
            <mat-label>Description (optional)</mat-label>
            <textarea matInput [(ngModel)]="newDescription" rows="2"></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full">
            <mat-label>First app idea (optional)</mat-label>
            <input matInput [(ngModel)]="appIdeaTitle" placeholder="What should this team build?" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full" *ngIf="appIdeaTitle.trim()">
            <mat-label>App idea details</mat-label>
            <textarea matInput [(ngModel)]="appIdeaDescription" rows="3"></textarea>
          </mat-form-field>

          <mat-checkbox [(ngModel)]="autoPlanOnCreate">
            Let Jarvis break this into specs or stories on the board
          </mat-checkbox>
          <mat-checkbox [(ngModel)]="startWorkingOnCreate">
            Start Working immediately after create (queues autonomous run for local runner)
          </mat-checkbox>
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-button (click)="clearBox()">Cancel</button>
          <button
            mat-flat-button
            color="primary"
            [disabled]="!newName.trim() || creating"
            (click)="createFromBox()"
          >
            {{ creating ? 'Creating…' : 'Create team' }}
          </button>
        </mat-card-actions>
      </mat-card>

      <mat-expansion-panel class="advanced">
        <mat-expansion-panel-header>
          <mat-panel-title>Advanced: empty team (manual setup)</mat-panel-title>
        </mat-expansion-panel-header>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="customName" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Workflow</mat-label>
          <mat-select [(ngModel)]="customWorkflowKey">
            <mat-option *ngFor="let w of workflows" [value]="w.key">{{ w.name }}</mat-option>
          </mat-select>
        </mat-form-field>
        <button mat-stroked-button [disabled]="!customName.trim() || creating" (click)="createCustomTeam()">
          Create empty team
        </button>
      </mat-expansion-panel>

      <div *ngIf="!loading && !teams.length" class="empty">
        <mat-icon>groups</mat-icon>
        <p>No teams yet. Choose a team type above to get started.</p>
      </div>

      <h3 class="section-title" *ngIf="teams.length">Your teams</h3>
      <div class="grid">
        <mat-card *ngFor="let team of teams" class="team-card">
          <mat-card-title>
            <a [routerLink]="['..', 'teams', team.id]">{{ team.name }}</a>
            <mat-chip *ngIf="team.paused_at" color="warn" selected>paused</mat-chip>
          </mat-card-title>
          <mat-card-subtitle *ngIf="team.workflow_template_key">
            {{ team.workflow_template_key }}
          </mat-card-subtitle>
          <mat-card-content>
            <p class="muted" *ngIf="team.description">{{ team.description }}</p>
          </mat-card-content>
          <mat-card-actions>
            <a mat-button [routerLink]="['..', 'teams', team.id]">Command center</a>
            <a mat-button [routerLink]="['..', 'teams', team.id, 'board']">Board</a>
          </mat-card-actions>
        </mat-card>
      </div>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 20px; }
      .header h2 { margin: 0 0 4px; }
      .intro { margin: 0; max-width: 640px; }
      .box-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 16px;
      }
      .box-card {
        cursor: pointer;
        transition: box-shadow 0.15s, border-color 0.15s;
        border: 2px solid transparent;
      }
      .box-card:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); }
      .box-card.selected { border-color: var(--mat-sys-primary, #1976d2); }
      .box-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
        margin-bottom: 8px;
        color: #444;
      }
      .box-card h3 { margin: 0 0 8px; font-size: 1.1rem; }
      .meta { font-size: 0.85rem; margin-top: 8px; }
      .brainstorm-card { background: #f8f9ff; border: 1px solid #c7d2fe; }
      .recommendation { margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
      .recommendation p { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .wizard-card { background: #fff; }
      .full { width: 100%; }
      .advanced { background: #fafafa; }
      .section-title { margin: 8px 0 0; font-size: 1rem; color: #555; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
      .team-card { background: #fff; }
      .team-card mat-card-title { display: flex; gap: 12px; align-items: center; }
      .team-card a { color: inherit; text-decoration: none; }
      .empty { text-align: center; padding: 48px 16px; color: #888; }
      .empty mat-icon { font-size: 48px; height: 48px; width: 48px; }
      .muted { color: #666; }
    `,
  ],
})
export class TeamsListComponent implements OnInit {
  teams: AgentTeam[] = [];
  boxes: TeamBoxCatalogEntry[] = [];
  workflows: WorkflowTemplate[] = [];
  loading = false;
  creating = false;

  selectedBoxKey: string | null = null;
  newName = '';
  newDescription = '';
  appIdeaTitle = '';
  appIdeaDescription = '';
  startWorkingOnCreate = false;
  autoPlanOnCreate = true;

  brainstormIdea = '';
  brainstormRequirements = '';
  recommending = false;
  recommendation: TeamBoxRecommendation | null = null;

  customName = '';
  customWorkflowKey = 'generic_software_delivery';

  constructor(private studio: AgentStudioService, private snack: MatSnackBar, private router: Router) {}

  get selectedBox(): TeamBoxCatalogEntry | null {
    return this.boxes.find((b) => b.key === this.selectedBoxKey) ?? null;
  }

  ngOnInit(): void {
    this.refresh();
    this.studio.listTeamBoxes().subscribe({
      next: (r) => (this.boxes = r.boxes),
      error: () => this.snack.open('Could not load team types', 'OK', { duration: 3000 }),
    });
    this.studio.listWorkflowTemplates().subscribe({ next: (r) => (this.workflows = r.templates) });
  }

  refresh(): void {
    this.loading = true;
    this.studio.listTeams().subscribe({
      next: (r) => {
        this.teams = r.teams;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.snack.open(err?.error?.error || 'Failed to load teams', 'OK', { duration: 4000 });
      },
    });
  }

  selectBox(box: TeamBoxCatalogEntry): void {
    this.selectedBoxKey = box.key;
    if (!this.newName.trim()) {
      this.newName = box.name.replace(' Team', '').replace(' Development', ' Squad');
    }
  }

  clearBox(): void {
    this.selectedBoxKey = null;
    this.newName = '';
    this.newDescription = '';
    this.appIdeaTitle = '';
    this.appIdeaDescription = '';
  }

  runRecommend(): void {
    if (!this.brainstormIdea.trim()) return;
    this.recommending = true;
    this.studio
      .recommendTeamBox({
        idea: this.brainstormIdea.trim(),
        requirements: this.brainstormRequirements.trim() || undefined,
      })
      .subscribe({
        next: (r) => {
          this.recommending = false;
          this.recommendation = r.recommendation;
        },
        error: (err) => {
          this.recommending = false;
          this.snack.open(err?.error?.error || 'Recommendation failed', 'OK', { duration: 4000 });
        },
      });
  }

  useRecommendation(rec: TeamBoxRecommendation): void {
    this.selectedBoxKey = rec.teamBoxKey;
    this.newName = rec.suggestedTeamName;
    this.appIdeaTitle = this.brainstormIdea.trim();
    this.appIdeaDescription = this.brainstormRequirements.trim();
    this.autoPlanOnCreate = true;
  }

  createFromBox(): void {
    if (!this.newName.trim() || !this.selectedBoxKey) return;
    this.creating = true;
    const idea = (this.appIdeaTitle || this.brainstormIdea).trim();
    const requirements = (this.appIdeaDescription || this.brainstormRequirements).trim();
    this.studio
      .createTeamFromBox({
        name: this.newName.trim(),
        description: this.newDescription.trim() || undefined,
        teamBoxKey: this.selectedBoxKey,
        idea: idea || undefined,
        requirements: requirements || undefined,
        autoPlan: this.autoPlanOnCreate && !!idea,
        deliveryMode: this.recommendation?.deliveryMode,
        startWorking: this.startWorkingOnCreate,
      })
      .subscribe({
        next: (res) => {
          this.creating = false;
          const msg = res.run
            ? `Team created — run queued. Pair a local runner to execute.`
            : `Team "${res.team.name}" ready with ${res.agents.length} agents + Jarvis.`;
          this.snack.open(msg, 'OK', { duration: 5000 });
          this.router.navigate(['/agent-studio', 'teams', res.team.id]);
        },
        error: (err) => {
          this.creating = false;
          this.snack.open(err?.error?.error || 'Create failed', 'OK', { duration: 5000 });
        },
      });
  }

  createCustomTeam(): void {
    if (!this.customName.trim()) return;
    this.creating = true;
    this.studio
      .createTeam({
        name: this.customName.trim(),
        workflowTemplateKey: this.customWorkflowKey,
      })
      .subscribe({
        next: (res) => {
          this.creating = false;
          this.router.navigate(['/agent-studio', 'teams', res.team.id]);
        },
        error: (err) => {
          this.creating = false;
          this.snack.open(err?.error?.error || 'Create failed', 'OK', { duration: 4000 });
        },
      });
  }
}

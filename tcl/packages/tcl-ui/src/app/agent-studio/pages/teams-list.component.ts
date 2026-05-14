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
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { AgentTeam, WorkflowTemplate } from '../agent-studio.types';

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
    MatSnackBarModule,
  ],
  template: `
    <section class="page">
      <header class="header">
        <h2>Teams</h2>
        <button mat-flat-button color="primary" (click)="showForm = !showForm">
          <mat-icon>add</mat-icon>
          New team
        </button>
      </header>

      <mat-card *ngIf="showForm" class="create-card">
        <mat-card-title>Create team</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="newName" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full">
            <mat-label>Description</mat-label>
            <textarea matInput [(ngModel)]="newDescription" rows="2"></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full">
            <mat-label>Workflow template</mat-label>
            <mat-select [(ngModel)]="newWorkflowKey">
              <mat-option [value]="null">— None —</mat-option>
              <mat-option *ngFor="let w of workflows" [value]="w.key">{{ w.name }}</mat-option>
            </mat-select>
          </mat-form-field>
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-button (click)="showForm = false">Cancel</button>
          <button mat-flat-button color="primary" [disabled]="!newName.trim() || creating" (click)="createTeam()">
            {{ creating ? 'Creating…' : 'Create team' }}
          </button>
        </mat-card-actions>
      </mat-card>

      <div *ngIf="!loading && !teams.length" class="empty">
        <mat-icon>groups</mat-icon>
        <p>No teams yet. Create your first team above.</p>
      </div>

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
            <p class="meta">
              <small class="muted">Created {{ team.created_at | date: 'mediumDate' }}</small>
            </p>
          </mat-card-content>
          <mat-card-actions>
            <a mat-button [routerLink]="['..', 'teams', team.id, 'board']">
              <mat-icon>view_kanban</mat-icon>
              Board
            </a>
            <a mat-button [routerLink]="['..', 'teams', team.id, 'agents']">
              <mat-icon>smart_toy</mat-icon>
              Agents
            </a>
            <a mat-button [routerLink]="['..', 'teams', team.id, 'ide']">
              <mat-icon>code</mat-icon>
              IDE
            </a>
          </mat-card-actions>
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
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
      .team-card { background: #fff; }
      .team-card mat-card-title { display: flex; gap: 12px; align-items: center; }
      .team-card a { color: inherit; text-decoration: none; }
      .empty { text-align: center; padding: 64px 16px; color: #888; }
      .empty mat-icon { font-size: 48px; height: 48px; width: 48px; }
      .muted { color: #666; }
      .meta { margin-top: 12px; }
    `,
  ],
})
export class TeamsListComponent implements OnInit {
  teams: AgentTeam[] = [];
  workflows: WorkflowTemplate[] = [];
  loading = false;
  showForm = false;
  newName = '';
  newDescription = '';
  newWorkflowKey: string | null = null;
  creating = false;

  constructor(private studio: AgentStudioService, private snack: MatSnackBar, private router: Router) {}

  ngOnInit(): void {
    this.refresh();
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

  createTeam(): void {
    if (!this.newName.trim()) return;
    this.creating = true;
    this.studio
      .createTeam({
        name: this.newName.trim(),
        description: this.newDescription.trim() || undefined,
        workflowTemplateKey: this.newWorkflowKey || undefined,
      })
      .subscribe({
        next: (res) => {
          this.creating = false;
          this.showForm = false;
          this.newName = '';
          this.newDescription = '';
          this.newWorkflowKey = null;
          this.snack.open(`Team "${res.team.name}" created.`, 'OK', { duration: 3000 });
          this.refresh();
        },
        error: (err) => {
          this.creating = false;
          this.snack.open(err?.error?.error || 'Create failed', 'OK', { duration: 4000 });
        },
      });
  }
}

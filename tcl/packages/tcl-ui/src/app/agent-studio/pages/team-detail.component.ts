import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AgentStudioService } from '../agent-studio.service';
import { AgentTeam, AuditEvent, TeamCommandCenter, TeamRun, TeamRunMode } from '../agent-studio.types';

@Component({
  selector: 'app-team-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatSnackBarModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <div class="pause-banner" *ngIf="cc?.orgPaused">
      <mat-icon>pause_circle</mat-icon>
      <span>Organization pause is on — dispatches and task mutations are blocked for this org.</span>
    </div>

    <div class="pause-banner team" *ngIf="cc && !cc.orgPaused && team?.paused_at">
      <mat-icon>pause_circle</mat-icon>
      <span>This team is paused.</span>
    </div>

    <div class="state-block" *ngIf="loading">
      <mat-progress-spinner diameter="36" mode="indeterminate" />
      <span>Loading command center…</span>
    </div>

    <section class="page" *ngIf="cc && team as t">
      <header class="header">
        <div>
          <h2>
            {{ t.name }}
            <mat-chip *ngIf="t.paused_at" color="warn" selected>team paused</mat-chip>
          </h2>
          <p class="muted" *ngIf="t.description">{{ t.description }}</p>
        </div>
        <div class="actions">
          <button mat-stroked-button color="warn" *ngIf="!t.paused_at" (click)="pause()">
            <mat-icon>pause</mat-icon> Pause team
          </button>
          <button mat-flat-button color="accent" *ngIf="t.paused_at" (click)="resume()">
            <mat-icon>play_arrow</mat-icon> Resume team
          </button>
        </div>
      </header>

      <div class="metrics">
        <mat-card class="metric">
          <span class="label">Team status</span>
          <strong>{{ t.paused_at ? 'Paused' : 'Active' }}</strong>
        </mat-card>
        <mat-card class="metric">
          <span class="label">Agent Manager</span>
          <strong>{{ cc.orchestratorCount > 0 ? cc.orchestratorCount + ' orchestrator(s)' : 'Not assigned' }}</strong>
        </mat-card>
        <mat-card class="metric">
          <span class="label">Agents (paused)</span>
          <strong>{{ cc.agentsTotal }} ({{ cc.agentsPaused }})</strong>
        </mat-card>
        <mat-card class="metric">
          <span class="label">Active tasks</span>
          <strong>{{ cc.tasksInProgress }}</strong>
        </mat-card>
        <mat-card class="metric">
          <span class="label">Blocked</span>
          <strong class="warn">{{ cc.tasksBlocked }}</strong>
        </mat-card>
        <mat-card class="metric">
          <span class="label">In review</span>
          <strong>{{ cc.tasksInReview }}</strong>
        </mat-card>
        <mat-card class="metric">
          <span class="label">Human reviews pending</span>
          <strong>{{ cc.pendingReviewGates }}</strong>
        </mat-card>
      </div>

      <mat-card class="actions-bar">
        <mat-card-content class="action-row">
          <button mat-flat-button color="primary" (click)="goBoard()">
            <mat-icon>view_kanban</mat-icon> Open board
          </button>
          <button mat-stroked-button color="primary" (click)="goIde()">
            <mat-icon>code</mat-icon> Open IDE
          </button>
          <button mat-stroked-button *ngIf="!t.paused_at" (click)="pause()">
            <mat-icon>pause</mat-icon> Pause team
          </button>
          <button mat-stroked-button *ngIf="t.paused_at" (click)="resume()">
            <mat-icon>play_arrow</mat-icon> Resume team
          </button>
          <button mat-stroked-button (click)="goBoard()">
            <mat-icon>add_task</mat-icon> Create task
          </button>
          <button mat-stroked-button (click)="goAgents()">
            <mat-icon>person_add</mat-icon> Add agent
          </button>
          <button mat-stroked-button (click)="instructionToManager()">
            <mat-icon>outgoing_mail</mat-icon> Send instruction to Agent Manager
          </button>
        </mat-card-content>
      </mat-card>

      <mat-card class="launch-card">
        <mat-card-title>Launch autonomous team</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Objective</mat-label>
            <textarea matInput rows="2" [(ngModel)]="runObjective"></textarea>
          </mat-form-field>
          <div class="launch-row">
            <mat-form-field appearance="outline">
              <mat-label>Run mode</mat-label>
              <mat-select [(ngModel)]="runMode">
                <mat-option value="RUN_UNTIL_BLOCKED">Run until blocked</mat-option>
                <mat-option value="ONE_STEP">One step</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Max steps</mat-label>
              <input matInput type="number" [(ngModel)]="runMaxSteps" />
            </mat-form-field>
          </div>
          <div *ngIf="activeRun as run" class="run-status">
            <mat-chip>{{ run.status }}</mat-chip>
            <span class="muted">{{ run.completed_steps }}/{{ run.max_steps }} steps</span>
          </div>
          <div class="launch-actions">
            <button mat-flat-button color="primary" (click)="launchTeam()" [disabled]="launching || !runObjective.trim()">Launch</button>
            <button mat-stroked-button (click)="stepRun()" [disabled]="!activeRun">One step</button>
            <button mat-stroked-button (click)="pauseRun()" [disabled]="!activeRun">Pause</button>
            <button mat-stroked-button (click)="resumeRun()" [disabled]="!activeRun">Resume</button>
            <button mat-stroked-button color="warn" (click)="cancelRun()" [disabled]="!activeRun">Cancel</button>
            <a mat-button [routerLink]="['/agent-studio', 'teams', teamId, 'jarvis']">Jarvis</a>
          </div>
        </mat-card-content>
      </mat-card>

      <div class="two-col">
        <mat-card>
          <mat-card-title>Recently completed</mat-card-title>
          <mat-card-content>
            <ul class="list" *ngIf="cc.recentCompleted.length; else noDone">
              <li *ngFor="let task of cc.recentCompleted">
                <span class="ti">{{ task.title }}</span>
                <span class="muted">{{ task.updated_at | date: 'short' }}</span>
              </li>
            </ul>
            <ng-template #noDone><p class="muted">No completed tasks yet.</p></ng-template>
          </mat-card-content>
        </mat-card>

        <mat-card>
          <mat-card-title>Shared context summary</mat-card-title>
          <mat-card-content>
            <pre class="ctx" *ngIf="cc.contextSummary; else noCtx">{{ cc.contextSummary }}</pre>
            <ng-template #noCtx><p class="muted">No team shared context entries yet.</p></ng-template>
          </mat-card-content>
        </mat-card>
      </div>

      <div class="two-col">
        <mat-card>
          <mat-card-title>Recent audit</mat-card-title>
          <mat-card-content>
            <ul class="list dense" *ngIf="cc.recentAudit.length; else noAud">
              <li *ngFor="let e of cc.recentAudit">
                <mat-chip class="tiny">{{ formatAudit(e) }}</mat-chip>
                <span class="muted">{{ e.created_at | date: 'short' }}</span>
              </li>
            </ul>
            <ng-template #noAud><p class="muted">No team-scoped audit rows yet.</p></ng-template>
          </mat-card-content>
        </mat-card>

        <mat-card>
          <mat-card-title>Recent mistakes / rules</mat-card-title>
          <mat-card-content>
            <ul class="list" *ngIf="cc.recentMistakes.length; else noMis">
              <li *ngFor="let m of cc.recentMistakes">
                <strong>{{ m.title }}</strong>
                <span class="muted">{{ m.severity }}</span>
              </li>
            </ul>
            <ng-template #noMis><p class="muted">No mistakes logged for this team.</p></ng-template>
          </mat-card-content>
        </mat-card>
      </div>

      <mat-card class="suggest">
        <mat-card-title>Suggested next action</mat-card-title>
        <mat-card-content>
          <p class="muted">
            Placeholder: when runs and dispatch are fully wired, this panel will recommend unblockers (for example,
            approve a pending review, resume a paused agent, or pull the next task from backlog).
          </p>
        </mat-card-content>
      </mat-card>

      <mat-divider />

      <div class="quick-grid">
        <a class="quick" [routerLink]="['/agent-studio', 'teams', t.id, 'board']">
          <mat-icon>view_kanban</mat-icon>
          <span>Kanban</span>
        </a>
        <a class="quick" [routerLink]="['/agent-studio', 'teams', t.id, 'agents']">
          <mat-icon>smart_toy</mat-icon>
          <span>Agents</span>
        </a>
        <a class="quick" [routerLink]="['/agent-studio', 'teams', t.id, 'context']">
          <mat-icon>library_books</mat-icon>
          <span>Context</span>
        </a>
        <a class="quick" [routerLink]="['/agent-studio', 'teams', t.id, 'rules']">
          <mat-icon>policy</mat-icon>
          <span>Rules</span>
        </a>
        <a class="quick" [routerLink]="['/agent-studio', 'teams', t.id, 'jarvis']">
          <mat-icon>psychology</mat-icon>
          <span>Jarvis</span>
        </a>
        <a class="quick" [routerLink]="['/agent-studio', 'teams', t.id, 'ide']">
          <mat-icon>code</mat-icon>
          <span>IDE</span>
        </a>
      </div>
    </section>

    <mat-card *ngIf="loadError" class="err">
      <mat-card-content>
        <p>{{ loadError }}</p>
        <button mat-stroked-button (click)="reload()">Retry</button>
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .pause-banner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        margin-bottom: 12px;
        border-radius: 8px;
        font-size: 14px;
      }
      .pause-banner:not(.team) {
        background: #fffbeb;
        border: 1px solid #fcd34d;
        color: #92400e;
      }
      .pause-banner.team {
        background: #fef3c7;
        border: 1px solid #fbbf24;
        color: #78350f;
      }
      .state-block {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 24px;
        color: #64748b;
      }
      .page {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 12px;
      }
      .header h2 {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
      }
      .actions {
        display: flex;
        gap: 8px;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px;
      }
      .metric {
        padding: 12px 14px !important;
      }
      .metric .label {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #64748b;
        margin-bottom: 4px;
      }
      .metric strong {
        font-size: 15px;
        color: #0f172a;
      }
      .metric .warn {
        color: #b45309;
      }
      .actions-bar .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 8px 0 !important;
      }
      .two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }
      @media (max-width: 900px) {
        .two-col {
          grid-template-columns: 1fr;
        }
      }
      .list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .list.dense li {
        flex-wrap: wrap;
      }
      .list li {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: baseline;
      }
      .ti {
        font-weight: 500;
      }
      .ctx {
        margin: 0;
        white-space: pre-wrap;
        font-family: inherit;
        font-size: 13px;
        line-height: 1.45;
        color: #334155;
        max-height: 220px;
        overflow: auto;
      }
      .muted {
        color: #64748b;
        font-size: 13px;
      }
      .tiny {
        font-size: 11px !important;
        min-height: 24px !important;
      }
      .suggest mat-card-content p {
        margin: 0;
      }
      .quick-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px;
      }
      .quick {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 20px;
        background: #fff;
        border-radius: 12px;
        text-decoration: none;
        color: #333;
        border: 1px solid #e5e7eb;
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      .quick:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
      }
      .quick mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        color: #1a237e;
      }
      .err {
        margin-top: 16px;
        border-color: #fecaca;
        background: #fef2f2;
      }
      .launch-card {
        background: #fff;
        border: 1px solid #c7d2fe;
      }
      .launch-row {
        display: grid;
        grid-template-columns: 1fr 120px;
        gap: 12px;
      }
      .full {
        width: 100%;
      }
      .launch-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .run-status {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
      }
    `,
  ],
})
export class TeamDetailComponent implements OnInit {
  team: AgentTeam | null = null;
  cc: TeamCommandCenter | null = null;
  loading = true;
  loadError: string | null = null;
  teamId = '';
  runObjective = '';
  runMode: TeamRunMode = 'RUN_UNTIL_BLOCKED';
  runMaxSteps = 25;
  activeRun: TeamRun | null = null;
  launching = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private studio: AgentStudioService,
    private snack: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.reload();
  }

  reload(): void {
    this.loading = true;
    this.loadError = null;
    this.studio.getTeamCommandCenter(this.teamId).subscribe({
      next: (payload) => {
        this.cc = payload;
        this.team = payload.team;
        this.loading = false;
        this.loadActiveRun();
      },
      error: (err) => {
        this.loading = false;
        this.loadError = err?.error?.message || err?.error?.error || 'Failed to load team';
      },
    });
  }

  formatAudit(e: AuditEvent): string {
    return e.event_type.replace(/\./g, ' · ');
  }

  goBoard(): void {
    this.router.navigate(['/agent-studio', 'teams', this.teamId, 'board']);
  }

  goIde(): void {
    this.router.navigate(['/agent-studio', 'teams', this.teamId, 'ide']);
  }

  goAgents(): void {
    this.router.navigate(['/agent-studio', 'teams', this.teamId, 'agents']);
  }

  loadActiveRun(): void {
    this.studio.listTeamRuns(this.teamId).subscribe({
      next: (r) => {
        const active = (r.runs ?? []).find((run) =>
          ['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_FOR_HUMAN', 'WAITING_FOR_REVIEW', 'BLOCKED'].includes(run.status)
        );
        this.activeRun = active ?? null;
      },
    });
  }

  launchTeam(): void {
    if (!this.runObjective.trim()) return;
    this.launching = true;
    this.studio
      .createTeamRun(this.teamId, {
        objective: this.runObjective.trim(),
        runMode: this.runMode,
        maxSteps: this.runMaxSteps,
        useJarvis: true,
      })
      .subscribe({
        next: (r) => {
          this.launching = false;
          this.activeRun = r.run;
          this.snack.open('Team run queued — start local runner to execute.', 'OK', { duration: 5000 });
        },
        error: (err) => {
          this.launching = false;
          this.snack.open(err?.error?.error || 'Launch failed', 'OK', { duration: 4000 });
        },
      });
  }

  stepRun(): void {
    if (!this.activeRun) return;
    this.studio.stepTeamRun(this.activeRun.id).subscribe({
      next: (r) => {
        this.activeRun = r.run;
        this.snack.open('Step queued for local runner.', 'OK', { duration: 3000 });
      },
      error: (err) => this.snack.open(err?.error?.error || 'Step failed', 'OK', { duration: 4000 }),
    });
  }

  pauseRun(): void {
    if (!this.activeRun) return;
    this.studio.pauseTeamRun(this.activeRun.id).subscribe({
      next: (r) => (this.activeRun = r.run),
    });
  }

  resumeRun(): void {
    if (!this.activeRun) return;
    this.studio.resumeTeamRun(this.activeRun.id).subscribe({
      next: (r) => (this.activeRun = r.run),
    });
  }

  cancelRun(): void {
    if (!this.activeRun) return;
    this.studio.cancelTeamRun(this.activeRun.id).subscribe({
      next: () => {
        this.activeRun = null;
        this.snack.open('Run cancelled.', 'OK', { duration: 2500 });
      },
    });
  }

  instructionToManager(): void {
    const msg = window.prompt('Instruction for Jarvis / Agent Manager:');
    if (!msg?.trim()) return;
    this.studio
      .appendTeamEvent(this.teamId, {
        eventType: 'user.instruction',
        summary: msg.trim(),
        actorType: 'USER',
        actorName: 'user',
        jsonl: { priority: 'high' },
      })
      .subscribe({
        next: () => this.snack.open('Instruction recorded in shared JSONL log.', 'OK', { duration: 3000 }),
      });
  }

  pause(): void {
    if (!this.team) return;
    const reason = window.prompt('Reason for pausing this team? (optional)') ?? undefined;
    this.studio.pauseTeam(this.team.id, reason).subscribe({
      next: (r) => {
        this.team = r.team;
        this.reload();
      },
      error: (err) => this.snack.open(err?.error?.error || 'Pause failed', 'OK', { duration: 4000 }),
    });
  }

  resume(): void {
    if (!this.team) return;
    this.studio.resumeTeam(this.team.id).subscribe({
      next: (r) => {
        this.team = r.team;
        this.reload();
      },
      error: (err) => this.snack.open(err?.error?.error || 'Resume failed', 'OK', { duration: 4000 }),
    });
  }
}

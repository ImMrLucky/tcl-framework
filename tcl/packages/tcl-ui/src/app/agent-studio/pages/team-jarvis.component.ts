import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { Agent, TeamEventLogEntry, TeamRun } from '../agent-studio.types';
import { migrationBannerText, migrationErrorText, responseNeedsMigration } from '../agent-studio-migration.util';

@Component({
  selector: 'app-team-jarvis',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatSnackBarModule,
  ],
  template: `
    <section class="page">
      <p class="migration-warn" *ngIf="migrationWarning">{{ migrationWarning }}</p>
      <header class="header">
        <a mat-icon-button routerLink="../"><mat-icon>arrow_back</mat-icon></a>
        <div>
          <h2>Jarvis command center</h2>
          <p class="muted">Team orchestrator — reads shared JSONL, coordinates agents, respects pause & review gates.</p>
        </div>
      </header>

      <mat-card *ngIf="activeRun">
        <mat-card-title>Active team run</mat-card-title>
        <mat-card-content>
          <mat-chip>{{ activeRun.status }}</mat-chip>
          <p>{{ activeRun.objective }}</p>
          <p class="muted">Steps {{ activeRun.completed_steps }} / {{ activeRun.max_steps }}</p>
        </mat-card-content>
      </mat-card>

      <mat-card>
        <mat-card-title>Ask Jarvis</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Instruction</mat-label>
            <textarea matInput rows="3" [(ngModel)]="instruction"></textarea>
          </mat-form-field>
          <div class="actions">
            <button mat-stroked-button (click)="sendInstruction()">Send to shared log</button>
            <button mat-stroked-button (click)="summarize()">Summarize progress</button>
            <button mat-stroked-button (click)="continueRun()">Tell Jarvis to continue</button>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card>
        <mat-card-title>Shared JSONL log (latest)</mat-card-title>
        <mat-card-content>
          <ul class="events">
            <li *ngFor="let e of events">
              <span class="seq">#{{ e.sequence }}</span>
              <mat-chip class="tiny">{{ e.actor_type }}</mat-chip>
              <strong>{{ e.summary }}</strong>
              <span class="muted">{{ e.created_at | date: 'short' }}</span>
            </li>
          </ul>
          <p class="muted" *ngIf="!events.length">No events yet.</p>
        </mat-card-content>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .header { display: flex; gap: 8px; align-items: flex-start; }
      .header h2 { margin: 0; }
      .muted { color: #64748b; }
      .full { width: 100%; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .events { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
      .events li { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; }
      .seq { color: #94a3b8; font-size: 12px; }
      .tiny { font-size: 11px; min-height: 22px; }
      .migration-warn {
        padding: 10px 12px;
        background: #fff7ed;
        border: 1px solid #fdba74;
        border-radius: 8px;
        color: #9a3412;
        font-size: 14px;
      }
    `,
  ],
})
export class TeamJarvisComponent implements OnInit {
  teamId = '';
  events: TeamEventLogEntry[] = [];
  activeRun: TeamRun | null = null;
  jarvis: Agent | null = null;
  instruction = '';
  migrationWarning: string | null = null;

  constructor(private route: ActivatedRoute, private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh();
    this.studio.listAgents(this.teamId).subscribe({
      next: (r) => (this.jarvis = r.agents.find((a) => a.is_orchestrator) ?? null),
    });
  }

  refresh(): void {
    this.studio.listTeamEvents(this.teamId, undefined, 100).subscribe({
      next: (r) => {
        if (responseNeedsMigration(r)) {
          this.migrationWarning = migrationBannerText(r);
          this.events = [];
          return;
        }
        this.events = [...(r.events ?? [])].reverse();
      },
      error: (err) => {
        const msg = migrationErrorText(err);
        if (msg) this.migrationWarning = msg;
      },
    });
    this.studio.listTeamRuns(this.teamId).subscribe({
      next: (r) => {
        if (responseNeedsMigration(r)) {
          this.migrationWarning = migrationBannerText(r);
          this.activeRun = null;
          return;
        }
        this.activeRun =
          r.runs.find((run) => ['QUEUED', 'RUNNING', 'PAUSED'].includes(run.status)) ?? null;
      },
      error: (err) => {
        const msg = migrationErrorText(err);
        if (msg) this.migrationWarning = msg;
      },
    });
  }

  sendInstruction(): void {
    if (!this.instruction.trim()) return;
    this.studio
      .appendTeamEvent(this.teamId, {
        eventType: 'jarvis.instruction',
        summary: this.instruction.trim(),
        actorType: 'USER',
        actorName: 'user',
        jsonl: { priority: 'high', target: 'JARVIS' },
      })
      .subscribe({
        next: () => {
          this.instruction = '';
          this.refresh();
          this.snack.open('Logged for Jarvis.', 'OK', { duration: 2500 });
        },
      });
  }

  summarize(): void {
    this.studio
      .appendTeamEvent(this.teamId, {
        eventType: 'jarvis.request',
        summary: 'User requested team progress summary',
        actorType: 'USER',
        teamRunId: this.activeRun?.id,
      })
      .subscribe({ next: () => this.refresh() });
  }

  continueRun(): void {
    if (!this.activeRun) {
      this.snack.open('Launch a team run first.', 'OK', { duration: 3000 });
      return;
    }
    this.studio.resumeTeamRun(this.activeRun.id).subscribe({
      next: (r) => {
        this.activeRun = r.run;
        this.snack.open('Run resumed — local runner will pick up jobs.', 'OK', { duration: 4000 });
      },
    });
  }
}

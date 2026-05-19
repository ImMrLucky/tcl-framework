import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { AgentTeam } from '../agent-studio.types';
import { LAST_BOARD_TEAM_STORAGE_KEY, rememberBoardTeam } from '../board-nav';

@Component({
  selector: 'app-board-hub',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <section class="page">
      <header class="header">
        <h2>Kanban boards</h2>
        <p class="muted">Each team has its own board for tasks, reviews, and agent assignments.</p>
      </header>

      <div class="loading" *ngIf="loading">
        <mat-progress-spinner diameter="36" mode="indeterminate" />
        <span>Loading teams…</span>
      </div>

      <mat-card *ngIf="!loading && !teams.length" class="empty-card">
        <mat-card-content>
          <mat-icon>view_kanban</mat-icon>
          <p>Create a team first, then open its Kanban board.</p>
          <a mat-flat-button color="primary" routerLink="../teams">
            <mat-icon>groups</mat-icon>
            Go to Teams
          </a>
        </mat-card-content>
      </mat-card>

      <div class="grid" *ngIf="!loading && teams.length">
        <mat-card *ngFor="let team of teams" class="team-card">
          <mat-card-title>
            {{ team.name }}
            <mat-chip *ngIf="team.paused_at" color="warn" selected>paused</mat-chip>
          </mat-card-title>
          <mat-card-subtitle *ngIf="team.workflow_template_key">{{ team.workflow_template_key }}</mat-card-subtitle>
          <mat-card-content>
            <p class="muted" *ngIf="team.description">{{ team.description }}</p>
          </mat-card-content>
          <mat-card-actions>
            <a mat-flat-button color="primary" [routerLink]="['..', 'teams', team.id, 'board']" (click)="rememberBoardTeam(team.id)">
              <mat-icon>view_kanban</mat-icon>
              Open board
            </a>
            <a mat-button [routerLink]="['..', 'teams', team.id]">Team hub</a>
          </mat-card-actions>
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
      .header h2 {
        margin: 0 0 4px;
      }
      .muted {
        color: #64748b;
        margin: 0;
      }
      .loading {
        display: flex;
        align-items: center;
        gap: 12px;
        color: #64748b;
        padding: 24px;
      }
      .empty-card mat-card-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 32px;
        text-align: center;
      }
      .empty-card mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: #94a3b8;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      }
      .team-card {
        background: #fff;
      }
    `,
  ],
})
export class BoardHubComponent implements OnInit {
  teams: AgentTeam[] = [];
  loading = true;

  constructor(
    private studio: AgentStudioService,
    private router: Router,
    private snack: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.studio.listTeams().subscribe({
      next: (r) => {
        this.teams = r.teams ?? [];
        this.loading = false;
        if (this.teams.length === 1) {
          this.openBoard(this.teams[0].id);
          return;
        }
        const last = this.readLastTeamId();
        if (last && this.teams.some((t) => t.id === last)) {
          this.openBoard(last);
        }
      },
      error: (err) => {
        this.loading = false;
        this.snack.open(err?.error?.error || 'Failed to load teams', 'OK', { duration: 4000 });
      },
    });
  }

  rememberBoardTeam = rememberBoardTeam;

  private readLastTeamId(): string | null {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage.getItem(LAST_BOARD_TEAM_STORAGE_KEY);
  }

  private openBoard(teamId: string): void {
    rememberBoardTeam(teamId);
    void this.router.navigate(['/agent-studio', 'teams', teamId, 'board']);
  }
}

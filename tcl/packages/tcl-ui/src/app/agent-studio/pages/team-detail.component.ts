import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { AgentTeam } from '../agent-studio.types';

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
  ],
  template: `
    <section class="page" *ngIf="team">
      <header class="header">
        <div>
          <h2>
            {{ team.name }}
            <mat-chip *ngIf="team.paused_at" color="warn" selected>paused</mat-chip>
          </h2>
          <p class="muted" *ngIf="team.description">{{ team.description }}</p>
        </div>
        <div class="actions">
          <button mat-stroked-button color="warn" *ngIf="!team.paused_at" (click)="pause()">
            <mat-icon>pause</mat-icon> Pause team
          </button>
          <button mat-flat-button color="accent" *ngIf="team.paused_at" (click)="resume()">
            <mat-icon>play_arrow</mat-icon> Resume team
          </button>
        </div>
      </header>

      <div class="quick-grid">
        <a class="quick" [routerLink]="['..', team.id, 'board']">
          <mat-icon>view_kanban</mat-icon>
          <span>Kanban Board</span>
        </a>
        <a class="quick" [routerLink]="['..', team.id, 'agents']">
          <mat-icon>smart_toy</mat-icon>
          <span>Agents</span>
        </a>
        <a class="quick" [routerLink]="['..', team.id, 'context']">
          <mat-icon>library_books</mat-icon>
          <span>Shared Context</span>
        </a>
        <a class="quick" [routerLink]="['..', team.id, 'rules']">
          <mat-icon>policy</mat-icon>
          <span>Rules / Mistakes</span>
        </a>
        <a class="quick" [routerLink]="['..', team.id, 'ide']">
          <mat-icon>code</mat-icon>
          <span>IDE</span>
        </a>
      </div>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 24px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; }
      .header h2 { display: flex; align-items: center; gap: 12px; margin: 0; }
      .actions { display: flex; gap: 8px; }
      .muted { color: #666; }
      .quick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
      .quick {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px;
        background: #fff;
        border-radius: 12px;
        text-decoration: none;
        color: #333;
        border: 1px solid #eee;
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      .quick:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
      .quick mat-icon { font-size: 32px; width: 32px; height: 32px; color: #1a237e; }
    `,
  ],
})
export class TeamDetailComponent implements OnInit {
  team: AgentTeam | null = null;

  constructor(
    private route: ActivatedRoute,
    private studio: AgentStudioService,
    private snack: MatSnackBar
  ) {}

  ngOnInit(): void {
    const teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh(teamId);
  }

  refresh(teamId: string): void {
    this.studio.getTeam(teamId).subscribe({
      next: (r) => (this.team = r.team),
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load team', 'OK', { duration: 4000 }),
    });
  }

  pause(): void {
    if (!this.team) return;
    const reason = window.prompt('Reason for pausing this team? (optional)') ?? undefined;
    this.studio.pauseTeam(this.team.id, reason).subscribe({
      next: (r) => (this.team = r.team),
      error: (err) => this.snack.open(err?.error?.error || 'Pause failed', 'OK', { duration: 4000 }),
    });
  }

  resume(): void {
    if (!this.team) return;
    this.studio.resumeTeam(this.team.id).subscribe({
      next: (r) => (this.team = r.team),
      error: (err) => this.snack.open(err?.error?.error || 'Resume failed', 'OK', { duration: 4000 }),
    });
  }
}

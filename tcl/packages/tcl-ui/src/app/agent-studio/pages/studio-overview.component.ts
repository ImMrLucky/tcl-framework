import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { AgentStudioService } from '../agent-studio.service';
import { AgentTeam, AuditEvent } from '../agent-studio.types';

/**
 * Overview page (root of /agent-studio). Shows team count, recent audit
 * events, and quick links into the rest of the studio. Doubles as a
 * smoke-test view for the backend wiring.
 */
@Component({
  selector: 'app-studio-overview',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
  ],
  template: `
    <section class="grid">
      <mat-card class="hero">
        <mat-card-title>Welcome to Agent Studio</mat-card-title>
        <mat-card-subtitle>
          Build, configure, orchestrate, and monitor teams of AI agents.
        </mat-card-subtitle>
        <mat-card-content>
          <p class="muted">
            This MVP is the foundation: data model, BYOK secrets, pause controls,
            templates, and IDE / Kanban shells. Autonomous execution and full
            integrations come in the next iteration (see the spec for details).
          </p>
          <div class="cta-row">
            <a mat-raised-button color="primary" routerLink="teams">
              <mat-icon>groups</mat-icon>
              Manage teams
            </a>
            <a mat-stroked-button routerLink="templates">
              <mat-icon>library_books</mat-icon>
              Browse templates
            </a>
            <a mat-stroked-button routerLink="settings">
              <mat-icon>tune</mat-icon>
              Studio settings
            </a>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="counts">
        <mat-card-title>Teams</mat-card-title>
        <mat-card-content>
          <div class="big">{{ teams.length }}</div>
          <div class="muted">total team(s) in this organization</div>
        </mat-card-content>
      </mat-card>

      <mat-card class="counts">
        <mat-card-title>Recent activity</mat-card-title>
        <mat-card-content>
          <ng-container *ngIf="events.length; else noEvents">
            <ul class="events">
              <li *ngFor="let e of events">
                <mat-chip [color]="chipColor(e)" selected>{{ e.event_type }}</mat-chip>
                <span class="muted">{{ e.created_at | date: 'short' }}</span>
              </li>
            </ul>
          </ng-container>
          <ng-template #noEvents>
            <p class="muted">No audit events yet — create your first team to get going.</p>
          </ng-template>
        </mat-card-content>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .grid {
        display: grid;
        grid-template-columns: 2fr 1fr;
        grid-auto-rows: minmax(140px, auto);
        gap: 16px;
      }
      .hero {
        grid-column: 1 / -1;
      }
      .cta-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      .muted {
        color: #666;
      }
      .big {
        font-size: 48px;
        font-weight: 600;
        line-height: 1;
        margin-bottom: 8px;
      }
      .events {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .events li {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    `,
  ],
})
export class StudioOverviewComponent implements OnInit {
  teams: AgentTeam[] = [];
  events: AuditEvent[] = [];

  constructor(private studio: AgentStudioService) {}

  ngOnInit(): void {
    this.studio.listTeams().subscribe({ next: (r) => (this.teams = r.teams), error: () => {} });
    this.studio.listAuditEvents(undefined, 6).subscribe({ next: (r) => (this.events = r.events), error: () => {} });
  }

  chipColor(e: AuditEvent): 'primary' | 'accent' | 'warn' {
    if (e.event_type.includes('pause')) return 'warn';
    if (e.event_type.includes('delete')) return 'warn';
    if (e.event_type.includes('create')) return 'primary';
    return 'accent';
  }
}

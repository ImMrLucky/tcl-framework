import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AgentStudioService } from '../agent-studio.service';
import { Agent, AgentStudioSummary, AgentTeam, AuditEvent } from '../agent-studio.types';

type OverviewPanel = 'teams' | 'agents';

interface AgentWithTeam extends Agent {
  teamName: string;
}

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
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="pause-banner" *ngIf="summary?.orgPaused">
      <mat-icon>pause_circle</mat-icon>
      <span>Organization-wide pause is active. Agent dispatches and mutations are blocked until you resume.</span>
      <button mat-stroked-button color="primary" (click)="resumeOrg()" [disabled]="busy">Resume org</button>
      <a mat-button routerLink="settings">Studio settings</a>
    </div>

    <section class="grid" *ngIf="!loadError && summary as s">
      <mat-card class="hero">
        <mat-card-title>Agent Studio</mat-card-title>
        <mat-card-subtitle>Operational overview for teams, agents, tasks, and reviews.</mat-card-subtitle>
        <mat-card-content>
          <p class="muted">
            Source of truth lives in teams, tasks, context, and audit — not only in the IDE. Use this dashboard
            to spot blocked work and reviews before opening each tab.
          </p>
          <div class="cta-row">
            <a mat-raised-button color="primary" routerLink="teams">
              <mat-icon>groups</mat-icon>
              All teams
            </a>
            <a mat-stroked-button color="primary" routerLink="teams">
              <mat-icon>add</mat-icon>
              Quick create team
            </a>
            <a mat-stroked-button color="primary" routerLink="templates">
              <mat-icon>library_books</mat-icon>
              Templates
            </a>
            <a mat-stroked-button color="primary" routerLink="settings">
              <mat-icon>tune</mat-icon>
              Settings
            </a>
            <a mat-stroked-button routerLink="vendors" fragment="what-to-install">
              <mat-icon>download</mat-icon>
              What to install
            </a>
          </div>
          <p class="install-hint muted">
            Using Agent Studio in the browser only? You do not need npm packages.
            <a routerLink="vendors" fragment="what-to-install">See what to install</a>
            for local runners or TCL SDK integration.
          </p>
        </mat-card-content>
      </mat-card>

      <mat-card
        class="stat stat-clickable"
        [class.stat-active]="expandedPanel === 'teams'"
        (click)="togglePanel('teams')"
        role="button"
        tabindex="0"
        (keydown.enter)="togglePanel('teams')"
        (keydown.space)="$event.preventDefault(); togglePanel('teams')"
      >
        <mat-card-title>
          <span>Teams</span>
          <mat-icon class="stat-chevron">{{ expandedPanel === 'teams' ? 'expand_less' : 'expand_more' }}</mat-icon>
        </mat-card-title>
        <mat-card-content>
          <div class="big">{{ s.teamsTotal }}</div>
          <div class="sub">{{ s.teamsPaused }} paused · click to {{ expandedPanel === 'teams' ? 'hide' : 'list' }}</div>
        </mat-card-content>
      </mat-card>

      <mat-card
        class="stat stat-clickable"
        [class.stat-active]="expandedPanel === 'agents'"
        (click)="togglePanel('agents')"
        role="button"
        tabindex="0"
        (keydown.enter)="togglePanel('agents')"
        (keydown.space)="$event.preventDefault(); togglePanel('agents')"
      >
        <mat-card-title>
          <span>Agents</span>
          <mat-icon class="stat-chevron">{{ expandedPanel === 'agents' ? 'expand_less' : 'expand_more' }}</mat-icon>
        </mat-card-title>
        <mat-card-content>
          <div class="big">{{ s.agentsTotal }}</div>
          <div class="sub">{{ s.agentsPaused }} paused · click to {{ expandedPanel === 'agents' ? 'hide' : 'list' }}</div>
        </mat-card-content>
      </mat-card>

      <mat-card class="wide list-panel" *ngIf="expandedPanel === 'teams'">
        <mat-card-title>
          <mat-icon>groups</mat-icon>
          All teams
        </mat-card-title>
        <mat-card-content>
          <div class="list-loading" *ngIf="listsLoading">
            <mat-progress-spinner diameter="28" mode="indeterminate" />
            <span>Loading teams…</span>
          </div>
          <ul class="entity-list" *ngIf="!listsLoading && teams.length">
            <li *ngFor="let team of teams" class="entity-row">
              <div class="entity-main">
                <a class="entity-link" [routerLink]="['/agent-studio', 'teams', team.id]">{{ team.name }}</a>
                <span class="muted" *ngIf="team.description">{{ team.description }}</span>
                <span class="muted meta" *ngIf="team.workflow_template_key">{{ team.workflow_template_key }}</span>
              </div>
              <div class="entity-actions">
                <mat-chip *ngIf="team.paused_at" color="warn" selected>paused</mat-chip>
                <a mat-button color="primary" [routerLink]="['/agent-studio', 'teams', team.id, 'agents']">Agents</a>
                <a mat-button [routerLink]="['/agent-studio', 'teams', team.id]">Open</a>
              </div>
            </li>
          </ul>
          <p class="muted" *ngIf="!listsLoading && !teams.length">No teams yet.</p>
          <div class="list-footer">
            <a mat-stroked-button color="primary" routerLink="teams">
              <mat-icon>open_in_new</mat-icon>
              Manage teams
            </a>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="wide list-panel" *ngIf="expandedPanel === 'agents'">
        <mat-card-title>
          <mat-icon>smart_toy</mat-icon>
          All agents
        </mat-card-title>
        <mat-card-content>
          <div class="list-loading" *ngIf="listsLoading">
            <mat-progress-spinner diameter="28" mode="indeterminate" />
            <span>Loading agents…</span>
          </div>
          <ul class="entity-list" *ngIf="!listsLoading && agents.length">
            <li *ngFor="let agent of agents" class="entity-row">
              <div class="entity-main">
                <a
                  class="entity-link"
                  [routerLink]="['/agent-studio', 'teams', agent.team_id, 'agents']"
                >
                  {{ agent.name }}
                </a>
                <span class="muted">{{ agent.teamName }}</span>
                <span class="muted meta" *ngIf="agent.role_template_key">{{ agent.role_template_key }}</span>
              </div>
              <div class="entity-actions">
                <mat-chip *ngIf="agent.is_orchestrator" color="primary" selected>orchestrator</mat-chip>
                <mat-chip *ngIf="agent.paused_at" color="warn" selected>paused</mat-chip>
                <a mat-button color="primary" [routerLink]="['/agent-studio', 'teams', agent.team_id]">Team</a>
              </div>
            </li>
          </ul>
          <p class="muted" *ngIf="!listsLoading && !agents.length">No agents yet. Create a team and add agents.</p>
          <div class="list-footer">
            <a mat-stroked-button color="primary" routerLink="teams">
              <mat-icon>groups</mat-icon>
              Browse teams
            </a>
          </div>
        </mat-card-content>
      </mat-card>

      <mat-card class="stat">
        <mat-card-title>Tasks in progress</mat-card-title>
        <mat-card-content>
          <div class="big">{{ s.tasksInProgress }}</div>
          <div class="sub">{{ s.tasksTotal }} total</div>
        </mat-card-content>
      </mat-card>

      <mat-card class="stat">
        <mat-card-title>Blocked</mat-card-title>
        <mat-card-content>
          <div class="big warn">{{ s.tasksBlocked }}</div>
          <div class="sub">tasks</div>
        </mat-card-content>
      </mat-card>

      <mat-card class="stat">
        <mat-card-title>Pending reviews</mat-card-title>
        <mat-card-content>
          <div class="big">{{ s.reviewsPending }}</div>
          <div class="sub">review gates</div>
        </mat-card-content>
      </mat-card>

      <mat-card class="stat">
        <mat-card-title>Recent runs</mat-card-title>
        <mat-card-content>
          <div class="big muted-sm">—</div>
          <div class="sub">Run logging ships in the next slice</div>
        </mat-card-content>
      </mat-card>

      <mat-card class="stat">
        <mat-card-title>Recent mistakes</mat-card-title>
        <mat-card-content>
          <div class="big muted-sm">—</div>
          <div class="sub">See team Rules / Mistakes</div>
        </mat-card-content>
      </mat-card>

      <mat-card class="wide">
        <mat-card-title>Needs attention</mat-card-title>
        <mat-card-content>
          <ul class="attention" *ngIf="s.needsAttention.length; else noAttention">
            <li *ngFor="let n of s.needsAttention">
              <mat-chip selected>{{ n.type }}</mat-chip>
              <div class="att-body">
                <strong>{{ n.label }}</strong>
                <span class="muted">{{ n.description }}</span>
              </div>
              <a
                mat-button
                color="primary"
                *ngIf="n.teamId"
                [routerLink]="['/agent-studio', 'teams', n.teamId]"
              >
                Open team
              </a>
            </li>
          </ul>
          <ng-template #noAttention>
            <p class="muted">Nothing flagged — blocked tasks, pending reviews, and paused agents appear here.</p>
          </ng-template>
        </mat-card-content>
      </mat-card>

      <mat-card class="wide">
        <mat-card-title>Recent audit activity</mat-card-title>
        <mat-card-content>
          <ul class="events" *ngIf="s.recentAuditEvents.length; else noAudit">
            <li *ngFor="let e of s.recentAuditEvents">
              <mat-chip [color]="chipColor(e)" selected>{{ formatAudit(e) }}</mat-chip>
              <span class="muted">{{ e.created_at | date: 'short' }}</span>
            </li>
          </ul>
          <ng-template #noAudit>
            <p class="muted">No audit events yet.</p>
          </ng-template>
        </mat-card-content>
      </mat-card>
    </section>

    <div class="state-block" *ngIf="loading">
      <mat-progress-spinner diameter="40" mode="indeterminate" />
      <span>Loading studio summary…</span>
    </div>

    <mat-card class="error-card" *ngIf="loadError">
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
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px 16px;
        margin-bottom: 16px;
        background: #fffbeb;
        border: 1px solid #fcd34d;
        border-radius: 8px;
        color: #92400e;
        font-size: 14px;
      }
      .pause-banner mat-icon {
        color: #d97706;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
      }
      @media (max-width: 1100px) {
        .grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      .hero {
        grid-column: 1 / -1;
        background: #fff !important;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
      }
      .hero ::ng-deep .mat-mdc-card-title {
        color: #0f172a;
        font-size: 1.375rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .hero ::ng-deep .mat-mdc-card-subtitle {
        color: #475569 !important;
        margin-top: 4px;
      }
      .stat {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .stat ::ng-deep .mat-mdc-card-title {
        color: #0f172a;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .stat-clickable {
        cursor: pointer;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .stat-clickable:hover {
        border-color: #93c5fd;
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.12);
      }
      .stat-clickable.stat-active {
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
      }
      .stat-chevron {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: #64748b;
      }
      .wide {
        grid-column: 1 / -1;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
      }
      .wide ::ng-deep .mat-mdc-card-title {
        font-size: 15px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .list-panel ::ng-deep .mat-mdc-card-title mat-icon {
        color: #3b82f6;
      }
      .big {
        font-size: 36px;
        font-weight: 600;
        line-height: 1.1;
        margin-bottom: 4px;
        color: #0f172a;
      }
      .big.warn {
        color: #b45309;
      }
      .muted-sm {
        font-size: 28px;
        color: #94a3b8;
      }
      .sub {
        font-size: 13px;
        color: #64748b;
      }
      .muted {
        color: #64748b;
        font-size: 13px;
      }
      .cta-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      .cta-row a mat-icon {
        margin-right: 4px;
        vertical-align: middle;
      }
      .install-hint {
        margin: 16px 0 0;
        font-size: 13px;
        line-height: 1.5;
      }
      .install-hint a { color: #6366f1; }
      .entity-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .entity-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px 14px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
      }
      .entity-main {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 180px;
        flex: 1;
      }
      .entity-link {
        font-weight: 600;
        color: #1d4ed8;
        text-decoration: none;
        font-size: 15px;
      }
      .entity-link:hover {
        text-decoration: underline;
      }
      .entity-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
      }
      .meta {
        font-size: 12px;
      }
      .list-loading {
        display: flex;
        align-items: center;
        gap: 12px;
        color: #64748b;
        padding: 8px 0;
      }
      .list-footer {
        margin-top: 12px;
        padding-top: 8px;
        border-top: 1px solid #e2e8f0;
      }
      .events,
      .attention {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .events li,
      .attention li {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .att-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 160px;
      }
      .state-block {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 32px;
        color: #64748b;
      }
      .error-card {
        border-color: #fecaca;
        background: #fef2f2;
      }
    `,
  ],
})
export class StudioOverviewComponent implements OnInit {
  summary: AgentStudioSummary | null = null;
  loading = true;
  loadError: string | null = null;
  busy = false;

  expandedPanel: OverviewPanel | null = null;
  teams: AgentTeam[] = [];
  agents: AgentWithTeam[] = [];
  listsLoading = false;

  constructor(private studio: AgentStudioService) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading = true;
    this.loadError = null;
    this.studio.getSummary().subscribe({
      next: (s) => {
        this.summary = s;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.loadError = err?.error?.error || err?.message || 'Failed to load summary';
      },
    });
  }

  togglePanel(panel: OverviewPanel): void {
    if (this.expandedPanel === panel) {
      this.expandedPanel = null;
      return;
    }
    this.expandedPanel = panel;
    if (panel === 'teams') {
      this.loadTeamsList();
    } else {
      this.loadAgentsList();
    }
  }

  loadTeamsList(): void {
    this.listsLoading = true;
    this.studio.listTeams().subscribe({
      next: (r) => {
        this.teams = r.teams ?? [];
        this.listsLoading = false;
      },
      error: () => {
        this.listsLoading = false;
      },
    });
  }

  loadAgentsList(): void {
    this.listsLoading = true;
    this.studio.listTeams().subscribe({
      next: (r) => {
        const teams = r.teams ?? [];
        if (!teams.length) {
          this.agents = [];
          this.listsLoading = false;
          return;
        }
        forkJoin(
          teams.map((team) =>
            this.studio.listAgents(team.id).pipe(
              map((res) =>
                (res.agents ?? []).map((agent) => ({
                  ...agent,
                  teamName: team.name,
                }))
              ),
              catchError(() => of([] as AgentWithTeam[]))
            )
          )
        ).subscribe({
          next: (groups) => {
            this.agents = groups.flat().sort((a, b) => a.name.localeCompare(b.name));
            this.listsLoading = false;
          },
          error: () => {
            this.listsLoading = false;
          },
        });
      },
      error: () => {
        this.listsLoading = false;
      },
    });
  }

  resumeOrg(): void {
    this.busy = true;
    this.studio.resumeAll().subscribe({
      next: () => {
        this.busy = false;
        this.reload();
      },
      error: () => {
        this.busy = false;
      },
    });
  }

  formatAudit(e: AuditEvent): string {
    const t = e.event_type.replace(/\./g, ' · ');
    const res = e.resource_type ? ` (${e.resource_type})` : '';
    return `${t}${res}`;
  }

  chipColor(e: AuditEvent): 'primary' | 'accent' | 'warn' {
    if (e.event_type.includes('pause')) return 'warn';
    if (e.event_type.includes('delete')) return 'warn';
    if (e.event_type.includes('create')) return 'primary';
    return 'accent';
  }
}

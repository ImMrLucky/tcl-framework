import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { AgentStudioService } from '../agent-studio.service';
import { ContextEntry, TeamEventLogEntry } from '../agent-studio.types';

@Component({
  selector: 'app-team-context',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTabsModule,
    MatExpansionModule,
  ],
  template: `
    <section class="page">
      <header class="header">
        <h2>Team context</h2>
        <button mat-flat-button color="primary" (click)="showForm = !showForm" *ngIf="tabIndex === 0">
          <mat-icon>add</mat-icon>
          Add pinned entry
        </button>
        <button mat-stroked-button (click)="showEventForm = !showEventForm" *ngIf="tabIndex === 1">
          <mat-icon>edit_note</mat-icon>
          Add manual event
        </button>
      </header>

      <mat-tab-group [(selectedIndex)]="tabIndex" (selectedIndexChange)="onTabChange($event)">
        <mat-tab label="Shared summary">
          <mat-card *ngIf="showForm" class="create-card">
            <mat-card-title>New context entry</mat-card-title>
            <mat-card-content>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Key</mat-label>
                <input matInput [(ngModel)]="newKey" placeholder="e.g. style_guide" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Content</mat-label>
                <textarea matInput rows="6" [(ngModel)]="newContent"></textarea>
              </mat-form-field>
              <mat-slide-toggle [(ngModel)]="newPinned">Pin to top</mat-slide-toggle>
            </mat-card-content>
            <mat-card-actions align="end">
              <button mat-button (click)="showForm = false">Cancel</button>
              <button mat-flat-button color="primary" (click)="create()" [disabled]="!newKey.trim() || creating">
                {{ creating ? 'Saving…' : 'Save' }}
              </button>
            </mat-card-actions>
          </mat-card>

          <div *ngIf="pinnedEntries.length">
            <h3 class="sub">Pinned rules</h3>
            <div class="grid">
              <mat-card *ngFor="let entry of pinnedEntries" class="entry-card">
                <mat-card-title>
                  {{ entry.key }}
                  <mat-chip color="primary" selected>pinned</mat-chip>
                </mat-card-title>
                <mat-card-content>
                  <pre class="content">{{ entry.content }}</pre>
                </mat-card-content>
              </mat-card>
            </div>
          </div>

          <div class="grid">
            <mat-card *ngFor="let entry of unpinnedEntries" class="entry-card">
              <mat-card-title>{{ entry.key }}</mat-card-title>
              <mat-card-subtitle>Updated {{ entry.updated_at | date: 'short' }}</mat-card-subtitle>
              <mat-card-content>
                <pre class="content">{{ entry.content }}</pre>
              </mat-card-content>
            </mat-card>
          </div>
          <p class="muted empty" *ngIf="!entries.length">No shared context entries yet.</p>
        </mat-tab>

        <mat-tab label="JSONL event log">
          <mat-card *ngIf="showEventForm" class="create-card">
            <mat-card-title>Manual JSONL event</mat-card-title>
            <mat-card-content>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Summary</mat-label>
                <textarea matInput rows="2" [(ngModel)]="eventSummary"></textarea>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Event type</mat-label>
                <input matInput [(ngModel)]="eventType" placeholder="user.note" />
              </mat-form-field>
            </mat-card-content>
            <mat-card-actions align="end">
              <button mat-button (click)="showEventForm = false">Cancel</button>
              <button mat-flat-button color="primary" (click)="appendManualEvent()" [disabled]="!eventSummary.trim()">
                Append
              </button>
            </mat-card-actions>
          </mat-card>

          <mat-card *ngFor="let e of events" class="event-row">
            <mat-card-content>
              <div class="event-head">
                <span class="seq">#{{ e.sequence }}</span>
                <mat-chip class="tiny">{{ e.actor_type }}</mat-chip>
                <span class="etype">{{ e.event_type }}</span>
                <span class="muted">{{ e.created_at | date: 'short' }}</span>
              </div>
              <p class="summary">{{ e.summary }}</p>
              <mat-expansion-panel *ngIf="e.jsonl && (e.jsonl | json) !== '{}'">
                <mat-expansion-panel-header>JSON payload</mat-expansion-panel-header>
                <pre class="content">{{ e.jsonl | json }}</pre>
              </mat-expansion-panel>
            </mat-card-content>
          </mat-card>
          <p class="muted empty" *ngIf="!events.length">No team events yet — launch a run or add a manual event.</p>
        </mat-tab>

        <mat-tab label="Agent contexts">
          <p class="muted pad">
            Per-agent private memory is stored server-side and updated by the local runner during autonomous runs.
            Open <strong>Agents</strong> to pause or assign work; Jarvis reads shared JSONL before orchestrating.
          </p>
        </mat-tab>
      </mat-tab-group>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
      .full { width: 100%; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-top: 16px; }
      .sub { grid-column: 1 / -1; margin: 8px 0 0; font-size: 14px; color: #64748b; }
      .entry-card mat-card-title { display: flex; align-items: center; gap: 8px; }
      .content { white-space: pre-wrap; word-wrap: break-word; font-family: Menlo, monospace; font-size: 13px; }
      .muted { color: #64748b; }
      .empty { text-align: center; padding: 32px; }
      .pad { padding: 16px; }
      .event-row { margin-top: 8px; }
      .event-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; }
      .seq { color: #94a3b8; font-weight: 600; }
      .etype { font-family: monospace; color: #475569; }
      .summary { margin: 8px 0 0; font-size: 14px; }
      .tiny { min-height: 22px; font-size: 11px; }
    `,
  ],
})
export class TeamContextComponent implements OnInit {
  entries: ContextEntry[] = [];
  events: TeamEventLogEntry[] = [];
  tabIndex = 0;
  showForm = false;
  showEventForm = false;
  newKey = '';
  newContent = '';
  newPinned = false;
  creating = false;
  eventSummary = '';
  eventType = 'user.manual';

  private teamId!: string;

  constructor(private route: ActivatedRoute, private studio: AgentStudioService, private snack: MatSnackBar) {}

  get pinnedEntries(): ContextEntry[] {
    return this.entries.filter((e) => e.pinned);
  }

  get unpinnedEntries(): ContextEntry[] {
    return this.entries.filter((e) => !e.pinned);
  }

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh();
  }

  onTabChange(index: number): void {
    if (index === 1) this.loadEvents();
  }

  refresh(): void {
    this.studio.listContexts({ teamId: this.teamId, scope: 'TEAM' }).subscribe({
      next: (r) => (this.entries = r.entries),
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load context', 'OK', { duration: 4000 }),
    });
    if (this.tabIndex === 1) this.loadEvents();
  }

  loadEvents(): void {
    this.studio.listTeamEvents(this.teamId, undefined, 100).subscribe({
      next: (r) => (this.events = [...(r.events ?? [])].reverse()),
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load events', 'OK', { duration: 4000 }),
    });
  }

  appendManualEvent(): void {
    if (!this.eventSummary.trim()) return;
    this.studio
      .appendTeamEvent(this.teamId, {
        eventType: this.eventType || 'user.manual',
        summary: this.eventSummary.trim(),
        actorType: 'USER',
        actorName: 'user',
        jsonl: { priority: 'high', manual: true },
      })
      .subscribe({
        next: () => {
          this.eventSummary = '';
          this.showEventForm = false;
          this.loadEvents();
          this.snack.open('Event appended — Jarvis treats manual events as high priority.', 'OK', { duration: 3500 });
        },
      });
  }

  create(): void {
    if (!this.newKey.trim()) return;
    this.creating = true;
    this.studio
      .createContext({
        teamId: this.teamId,
        scope: 'TEAM',
        key: this.newKey.trim(),
        content: this.newContent,
        pinned: this.newPinned,
      })
      .subscribe({
        next: () => {
          this.creating = false;
          this.showForm = false;
          this.newKey = '';
          this.newContent = '';
          this.newPinned = false;
          this.refresh();
        },
        error: (err) => {
          this.creating = false;
          this.snack.open(err?.error?.error || 'Failed to save', 'OK', { duration: 4000 });
        },
      });
  }
}

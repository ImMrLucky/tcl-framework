import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TclAnalysisRow, PatchProposalRow, StudioTclReport } from '../agent-studio.types';
import { AgentStudioService } from '../agent-studio.service';

@Component({
  selector: 'app-tcl-live',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <section class="tcl-page">
      <header class="tcl-hdr">
        <div>
          <h1>TCL Insights</h1>
          <p class="sub">
            The TCL engine analyzes agent output as your team works — contradictions, grounding gaps, and fix suggestions.
          </p>
        </div>
        <div class="hdr-actions">
          <a
            *ngIf="teamId"
            mat-stroked-button
            [href]="browserRunnerUrl"
            target="_blank"
            rel="noopener"
          >
            <mat-icon>open_in_new</mat-icon>
            Open browser runner
          </a>
          <mat-chip *ngIf="streamConnected" class="live-chip">Live</mat-chip>
          <button mat-stroked-button (click)="refresh()" [disabled]="loading">
            <mat-icon>refresh</mat-icon>
            Refresh
          </button>
        </div>
      </header>

      <section class="patches" *ngIf="teamId && patches.length">
        <h2>Patch proposals</h2>
        <mat-card *ngFor="let p of patches" class="patch-card">
          <mat-card-title>{{ p.title }}</mat-card-title>
          <mat-card-subtitle>{{ p.status }} · {{ p.created_at | date: 'short' }}</mat-card-subtitle>
          <mat-card-content>
            <p *ngIf="p.summary">{{ p.summary }}</p>
            <p class="muted">{{ p.files?.length ?? 0 }} file(s)</p>
          </mat-card-content>
          <mat-card-actions>
            <button mat-button (click)="applyPatch(p.id)" *ngIf="p.status === 'PROPOSED' || p.status === 'APPROVED'">
              Apply to IDE
            </button>
            <button mat-button (click)="rejectPatch(p.id)" *ngIf="p.status === 'PROPOSED'">Reject</button>
          </mat-card-actions>
        </mat-card>
      </section>

      <p *ngIf="migrationRequired" class="warn">
        Run Supabase migration <code>{{ migrationRequired }}</code> to enable TCL analytics.
      </p>

      <div *ngIf="loading && !analyses.length" class="loading">
        <mat-spinner diameter="36"></mat-spinner>
        <span>Loading TCL findings…</span>
      </div>

      <p *ngIf="!loading && !analyses.length && !migrationRequired" class="empty">
        No TCL analyses yet. Complete an agent run or use Analyze below when agents produce output.
      </p>

      <div class="grid" *ngIf="analyses.length">
        <mat-card *ngFor="let row of analyses" class="tcl-card">
          <mat-card-header>
            <mat-card-title>{{ row.trigger }}</mat-card-title>
            <mat-card-subtitle>{{ row.created_at | date: 'medium' }}</mat-card-subtitle>
            <span class="spacer"></span>
            <mat-chip [class.ok]="row.status === 'SUCCEEDED'" [class.fail]="row.status === 'FAILED'">
              {{ row.status }}
            </mat-chip>
          </mat-card-header>
          <mat-card-content *ngIf="row.report as r">
            <p class="score" *ngIf="r.scores.overall != null">
              TCL score: <strong>{{ r.scores.overall | number: '1.0-0' }}</strong>
              <span class="muted"> · truth {{ r.scores.truth ?? '—' }}</span>
            </p>
            <p class="summary" *ngIf="r.summary">{{ r.summary }}</p>
            <ul class="issues" *ngIf="r.issues?.length">
              <li *ngFor="let i of r.issues | slice: 0 : 5">
                <strong [class]="i.severity">{{ i.severity }}</strong>
                {{ i.title }} — {{ i.recommendedAction }}
              </li>
            </ul>
            <div class="fixes" *ngIf="r.suggestions?.length">
              <h4>Suggested fixes</h4>
              <ul>
                <li *ngFor="let s of r.suggestions | slice: 0 : 4">
                  <mat-chip class="prio">{{ s.priority }}</mat-chip>
                  {{ s.title }}: {{ s.suggestedAction }}
                </li>
              </ul>
            </div>
          </mat-card-content>
          <mat-card-content *ngIf="row.error">
            <p class="err">{{ row.error }}</p>
          </mat-card-content>
        </mat-card>
      </div>

      <section class="manual" *ngIf="teamId">
        <h2>Analyze now</h2>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Question / task context</mat-label>
          <textarea matInput rows="3" [(ngModel)]="manualQuestion"></textarea>
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Agent answer / output</mat-label>
          <textarea matInput rows="6" [(ngModel)]="manualAnswer"></textarea>
        </mat-form-field>
        <button mat-flat-button color="primary" (click)="runManual()" [disabled]="analyzing">
          Run TCL analysis
        </button>
      </section>
    </section>
  `,
  styles: [
    `
      .tcl-page {
        padding: 1.25rem 1.5rem 2rem;
        max-width: 1100px;
      }
      .tcl-hdr {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }
      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
      .sub {
        color: var(--text-secondary, #666);
        margin: 0.35rem 0 0;
        max-width: 42rem;
      }
      .hdr-actions {
        display: flex;
        gap: 0.5rem;
        flex-shrink: 0;
      }
      .grid {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-bottom: 2rem;
      }
      .tcl-card mat-card-header {
        display: flex;
        align-items: center;
      }
      .spacer {
        flex: 1;
      }
      mat-chip.ok {
        background: #e8f5e9;
      }
      mat-chip.fail {
        background: #ffebee;
      }
      .score strong {
        font-size: 1.25rem;
      }
      .muted {
        font-size: 0.85rem;
        opacity: 0.7;
      }
      .summary {
        color: var(--text-secondary, #555);
      }
      .issues,
      .fixes ul {
        margin: 0.5rem 0 0;
        padding-left: 1.2rem;
      }
      .fixes h4 {
        margin: 0.75rem 0 0.25rem;
        font-size: 0.9rem;
      }
      .prio {
        font-size: 0.7rem;
        height: 22px;
        margin-right: 0.35rem;
      }
      .critical,
      .high {
        color: #c62828;
      }
      .warn {
        background: #fff8e1;
        padding: 0.75rem 1rem;
        border-radius: 8px;
      }
      .empty,
      .loading {
        color: var(--text-secondary, #666);
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .manual .full {
        width: 100%;
        display: block;
      }
      .err {
        color: #c62828;
      }
      .live-chip {
        background: #e3f2fd;
        color: #1565c0;
      }
      .patches {
        margin-bottom: 1.5rem;
      }
      .patches h2 {
        font-size: 1.1rem;
        margin: 0 0 0.75rem;
      }
      .patch-card {
        margin-bottom: 0.5rem;
      }
    `,
  ],
})
export class TclLiveComponent implements OnInit, OnDestroy {
  teamId: string | null = null;
  analyses: TclAnalysisRow[] = [];
  patches: PatchProposalRow[] = [];
  loading = false;
  analyzing = false;
  streamConnected = false;
  migrationRequired: string | null = null;
  manualQuestion = '';
  manualAnswer = '';
  browserRunnerUrl = 'http://localhost:5174';

  private disconnectStream?: () => void;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private studio: AgentStudioService,
    private snack: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.teamId = p.get('teamId');
      this.analyses = [];
      this.patches = [];
      this.startStream();
      this.updateBrowserRunnerUrl();
    });
  }

  ngOnDestroy(): void {
    this.disconnectStream?.();
  }

  private updateBrowserRunnerUrl(): void {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const q = new URLSearchParams();
    q.set('api', origin || 'http://localhost:3000');
    if (this.teamId) q.set('teamId', this.teamId);
    this.browserRunnerUrl = `http://localhost:5174?${q.toString()}`;
  }

  private mergeAnalysis(row: TclAnalysisRow): void {
    const byId = new Map(this.analyses.map((a) => [a.id, a]));
    byId.set(row.id, row);
    this.analyses = [...byId.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  private loadInitial(): void {
    this.loading = true;
    const obs = this.teamId
      ? this.studio.listTeamTclAnalyses(this.teamId, 40)
      : this.studio.listTclLiveFeed(undefined, undefined, 40);
    obs.subscribe({
      next: (res) => {
        this.loading = false;
        if (res.migrationRequired) {
          this.migrationRequired = res.migrationRequired;
          return;
        }
        this.migrationRequired = null;
        for (const row of res.analyses ?? []) this.mergeAnalysis(row);
        this.loadPatches();
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  private loadPatches(): void {
    if (!this.teamId) return;
    this.studio.listTeamPatches(this.teamId, 'PROPOSED').subscribe({
      next: (res) => {
        this.patches = res.patches ?? [];
      },
    });
  }

  private startStream(): void {
    this.disconnectStream?.();
    this.loadInitial();
    this.streamConnected = true;
    this.disconnectStream = this.studio.connectTclStream((payload) => {
      const row = payload as unknown as TclAnalysisRow;
      if (!row.created_at) row.created_at = new Date().toISOString();
      this.mergeAnalysis(row);
      if (row.status === 'SUCCEEDED') this.loadPatches();
    }, this.teamId ?? undefined);
  }

  refresh(): void {
    this.analyses = [];
    this.startStream();
  }

  applyPatch(patchId: string): void {
    if (!this.teamId) return;
    this.studio.applyTeamPatch(this.teamId, patchId).subscribe({
      next: (res) => {
        const key = `agent-studio-ide-workspace:${this.teamId}`;
        let existing: Record<string, string> = {};
        try {
          existing = JSON.parse(sessionStorage.getItem(key) || '{}');
        } catch {
          existing = {};
        }
        Object.assign(existing, res.workspace);
        sessionStorage.setItem(key, JSON.stringify(existing));
        this.snack
          .open('TCL patch applied to IDE workspace', 'Open IDE', { duration: 5000 })
          .onAction()
          .subscribe(() => {
            void this.router.navigate(['/agent-studio', 'teams', this.teamId, 'ide']);
          });
        this.loadPatches();
      },
      error: (e) => {
        this.snack.open(e?.error?.error ?? 'Apply failed', 'OK', { duration: 4000 });
      },
    });
  }

  rejectPatch(patchId: string): void {
    if (!this.teamId) return;
    this.studio.updatePatchStatus(this.teamId, patchId, 'REJECTED').subscribe({
      next: () => this.loadPatches(),
    });
  }

  runManual(): void {
    if (!this.teamId || !this.manualAnswer.trim()) {
      this.snack.open('Team and agent output are required', 'OK', { duration: 3000 });
      return;
    }
    this.analyzing = true;
    this.studio
      .analyzeWithTcl(this.teamId, {
        question: this.manualQuestion || 'Review agent work',
        answer: this.manualAnswer,
        trigger: 'MANUAL',
      })
      .subscribe({
        next: () => {
          this.analyzing = false;
          this.snack.open('TCL analysis complete', 'OK', { duration: 2500 });
          this.refresh();
        },
        error: (e) => {
          this.analyzing = false;
          this.snack.open(e?.error?.error ?? 'Analysis failed', 'OK', { duration: 4000 });
        },
      });
  }
}

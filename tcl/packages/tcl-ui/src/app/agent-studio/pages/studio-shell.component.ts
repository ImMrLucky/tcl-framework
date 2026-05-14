import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { AgentStudioSettings } from '../agent-studio.types';

/**
 * Agent Studio shell: dedicated left navigation (not the main ProtectQA sidebar)
 * plus a top workspace bar and router-outlet.
 */
@Component({
  selector: 'app-agent-studio-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="studio-app">
      <aside class="studio-rail" aria-label="Agent Studio navigation">
        <div class="rail-brand">
          <mat-icon class="rail-brand-icon">smart_toy</mat-icon>
          <div class="rail-brand-text">
            <span class="rail-brand-title">Agent Studio</span>
            <span class="rail-brand-sub">Developer workspace</span>
          </div>
        </div>

        <nav class="rail-nav">
          <a
            class="rail-link"
            routerLink="."
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
          >
            <mat-icon>dashboard</mat-icon>
            <span>Overview</span>
          </a>
          <a class="rail-link" routerLink="teams" routerLinkActive="active">
            <mat-icon>groups</mat-icon>
            <span>Teams</span>
          </a>
          <a class="rail-link" routerLink="templates/packs" routerLinkActive="active">
            <mat-icon>inventory_2</mat-icon>
            <span>Packs</span>
          </a>
          <a class="rail-link" routerLink="templates/roles" routerLinkActive="active">
            <mat-icon>badge</mat-icon>
            <span>Roles</span>
          </a>
          <a class="rail-link" routerLink="templates/personas" routerLinkActive="active">
            <mat-icon>mood</mat-icon>
            <span>Personas</span>
          </a>
          <a class="rail-link" routerLink="templates/files" routerLinkActive="active">
            <mat-icon>article</mat-icon>
            <span>File templates</span>
          </a>
          <a class="rail-link" routerLink="templates" routerLinkActive="active">
            <mat-icon>library_books</mat-icon>
            <span>Catalog</span>
          </a>
          <a class="rail-link" routerLink="integrations" routerLinkActive="active">
            <mat-icon>link</mat-icon>
            <span>Integrations</span>
          </a>
          <a class="rail-link" routerLink="settings" routerLinkActive="active">
            <mat-icon>tune</mat-icon>
            <span>Settings</span>
          </a>
        </nav>

        <div class="rail-footer">
          <a class="rail-back" routerLink="/dashboard">
            <mat-icon>arrow_back</mat-icon>
            <span>Back to ProtectQA</span>
          </a>
        </div>
      </aside>

      <div class="studio-workspace">
        <header class="studio-topbar">
          <h1 class="topbar-heading">Workspace</h1>
          <span class="spacer"></span>

          <mat-chip *ngIf="settings?.paused_at" class="chip-paused" color="warn">
            <mat-icon>pause_circle</mat-icon>
            Globally paused
          </mat-chip>

          <button
            mat-stroked-button
            class="btn-pause"
            *ngIf="settings && !settings.paused_at"
            (click)="pauseAll()"
          >
            <mat-icon>pause</mat-icon>
            Pause all
          </button>
          <button mat-flat-button color="primary" *ngIf="settings?.paused_at" (click)="resumeAll()">
            <mat-icon>play_arrow</mat-icon>
            Resume all
          </button>
        </header>

        <main class="studio-main">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
        min-height: 100vh;
        background: var(--as-surface, #f1f5f9);
      }
      .studio-app {
        display: flex;
        height: 100%;
        min-height: 0;
      }

      /* Left rail — visually separate from main app chrome */
      .studio-rail {
        width: 232px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, #0f172a 0%, #0c1222 100%);
        color: #e2e8f0;
        border-right: 1px solid #1e293b;
        box-shadow: 4px 0 24px rgba(15, 23, 42, 0.12);
      }
      .rail-brand {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 20px 16px 18px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.15);
      }
      .rail-brand-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        color: #7dd3fc;
      }
      .rail-brand-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .rail-brand-title {
        font-weight: 700;
        font-size: 15px;
        letter-spacing: 0.02em;
        color: #f8fafc;
      }
      .rail-brand-sub {
        font-size: 11px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .rail-nav {
        display: flex;
        flex-direction: column;
        padding: 12px 10px;
        gap: 4px;
        flex: 1;
        overflow-y: auto;
      }
      .rail-link {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        color: #cbd5e1;
        text-decoration: none;
        font-size: 14px;
        font-weight: 500;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .rail-link mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: #94a3b8;
      }
      .rail-link:hover {
        background: rgba(148, 163, 184, 0.12);
        color: #f8fafc;
      }
      .rail-link:hover mat-icon {
        color: #7dd3fc;
      }
      .rail-link.active {
        background: rgba(56, 189, 248, 0.12);
        color: #f0f9ff;
        box-shadow: inset 3px 0 0 #38bdf8;
      }
      .rail-link.active mat-icon {
        color: #38bdf8;
      }

      .rail-footer {
        padding: 12px 10px 16px;
        border-top: 1px solid rgba(148, 163, 184, 0.12);
      }
      .rail-back {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 13px;
        color: #94a3b8;
        text-decoration: none;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .rail-back mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .rail-back:hover {
        background: rgba(148, 163, 184, 0.1);
        color: #e2e8f0;
      }

      .studio-workspace {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .studio-topbar {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
        padding: 0 24px;
        min-height: 56px;
        background: #fff;
        border-bottom: 1px solid #e2e8f0;
        box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
      }
      .topbar-heading {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #0f172a;
        letter-spacing: -0.02em;
      }
      .spacer {
        flex: 1;
      }
      .chip-paused {
        --mdc-chip-label-text-color: #991b1b;
        --mdc-chip-elevated-container-color: #fef2f2;
      }
      .btn-pause {
        border-color: #fca5a5 !important;
        color: #b91c1c !important;
      }

      .studio-main {
        flex: 1;
        overflow-y: auto;
        padding: 24px;
        min-height: 0;
      }
    `,
  ],
})
export class StudioShellComponent implements OnInit {
  settings: AgentStudioSettings | null = null;

  constructor(
    private studio: AgentStudioService,
    private snack: MatSnackBar,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.refreshSettings();
  }

  refreshSettings(): void {
    this.studio.getSettings().subscribe({
      next: (res) => (this.settings = res.settings),
      error: (err) => {
        const code = err?.error?.error as string | undefined;
        if (err?.status === 401) {
          this.snack.open('Please sign in again to use Agent Studio.', 'OK', { duration: 5000 });
          void this.router.navigateByUrl('/login');
          return;
        }
        if (err?.status === 403 && code === 'FEATURE_NOT_AVAILABLE') {
          this.snack.open(
            'This environment is still enforcing the old Agent Studio org flag. Deploy the latest API or enable agentStudio in org_entitlements.',
            'OK',
            { duration: 9000 }
          );
          void this.router.navigateByUrl('/dashboard');
          return;
        }
        if (err?.status === 403) {
          this.snack.open(err?.error?.message || 'Access denied.', 'OK', { duration: 6000 });
          return;
        }
        const msg = err?.error?.message || err?.message || 'Failed to load Agent Studio settings';
        this.snack.open(msg, 'OK', { duration: 6000 });
        console.error('[agent-studio] failed to load settings', err);
      },
    });
  }

  pauseAll(): void {
    const reason = window.prompt('Reason for global pause? (optional)') ?? undefined;
    this.studio.pauseAll(reason).subscribe({
      next: (res) => {
        this.settings = res.settings;
        this.snack.open('All agents paused.', 'OK', { duration: 3000 });
      },
      error: (err) => this.snack.open(err?.error?.error || 'Pause failed', 'OK', { duration: 4000 }),
    });
  }

  resumeAll(): void {
    this.studio.resumeAll().subscribe({
      next: (res) => {
        this.settings = res.settings;
        this.snack.open('Agents resumed.', 'OK', { duration: 3000 });
      },
      error: (err) => this.snack.open(err?.error?.error || 'Resume failed', 'OK', { duration: 4000 }),
    });
  }
}

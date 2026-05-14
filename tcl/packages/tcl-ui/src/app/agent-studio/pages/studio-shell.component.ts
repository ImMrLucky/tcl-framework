import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { AgentStudioSettings } from '../agent-studio.types';

/**
 * Shell layout for /agent-studio/* routes. Renders the top bar with the
 * global pause control + sub-route nav links, and a router-outlet for child
 * pages.
 */
@Component({
  selector: 'app-agent-studio-shell',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatToolbarModule,
    MatChipsModule,
    MatSnackBarModule,
  ],
  template: `
    <mat-toolbar color="primary" class="studio-toolbar">
      <mat-icon class="brand-icon">smart_toy</mat-icon>
      <span class="brand">Agent Studio</span>

      <span class="spacer"></span>

      <mat-chip *ngIf="settings?.paused_at" color="warn" selected>
        <mat-icon>pause_circle</mat-icon>
        Globally paused
      </mat-chip>

      <button
        mat-stroked-button
        color="warn"
        *ngIf="settings && !settings.paused_at"
        (click)="pauseAll()"
      >
        <mat-icon>pause</mat-icon>
        Pause all
      </button>
      <button
        mat-flat-button
        color="accent"
        *ngIf="settings?.paused_at"
        (click)="resumeAll()"
      >
        <mat-icon>play_arrow</mat-icon>
        Resume all
      </button>
    </mat-toolbar>

    <nav class="studio-subnav">
      <a routerLink="." routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Overview</a>
      <a routerLink="teams" routerLinkActive="active">Teams</a>
      <a routerLink="templates" routerLinkActive="active">Templates</a>
      <a routerLink="integrations" routerLinkActive="active">Integrations</a>
      <a routerLink="settings" routerLinkActive="active">Settings</a>
    </nav>

    <main class="studio-main">
      <router-outlet></router-outlet>
    </main>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: #f6f7fb;
      }
      .studio-toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        background: #1a237e;
        color: #fff;
      }
      .brand-icon {
        margin-right: 4px;
      }
      .brand {
        font-weight: 600;
        letter-spacing: 0.3px;
      }
      .spacer {
        flex: 1;
      }
      .studio-subnav {
        display: flex;
        gap: 24px;
        padding: 12px 24px;
        background: #fff;
        border-bottom: 1px solid #e0e0e0;
        overflow-x: auto;
      }
      .studio-subnav a {
        color: #555;
        text-decoration: none;
        font-weight: 500;
        padding: 6px 0;
        border-bottom: 2px solid transparent;
        white-space: nowrap;
      }
      .studio-subnav a.active {
        color: #1a237e;
        border-bottom-color: #1a237e;
      }
      .studio-main {
        flex: 1;
        overflow-y: auto;
        padding: 24px;
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
        if (err?.status === 403) {
          this.snack.open('Agent Studio is not enabled for this organization.', 'OK', { duration: 5000 });
          this.router.navigateByUrl('/dashboard');
        } else {
          console.error('[agent-studio] failed to load settings', err);
        }
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

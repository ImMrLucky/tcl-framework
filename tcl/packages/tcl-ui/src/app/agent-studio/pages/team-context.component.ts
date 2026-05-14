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
import { AgentStudioService } from '../agent-studio.service';
import { ContextEntry } from '../agent-studio.types';

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
  ],
  template: `
    <section class="page">
      <header class="header">
        <h2>Shared team context</h2>
        <button mat-flat-button color="primary" (click)="showForm = !showForm">
          <mat-icon>add</mat-icon>
          Add context entry
        </button>
      </header>

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

      <div *ngIf="!entries.length" class="empty">
        <mat-icon>library_books</mat-icon>
        <p>No shared context entries yet.</p>
      </div>

      <div class="grid">
        <mat-card *ngFor="let entry of entries" class="entry-card">
          <mat-card-title>
            {{ entry.key }}
            <mat-chip *ngIf="entry.pinned" color="primary" selected>pinned</mat-chip>
          </mat-card-title>
          <mat-card-subtitle>Updated {{ entry.updated_at | date: 'short' }}</mat-card-subtitle>
          <mat-card-content>
            <pre class="content">{{ entry.content }}</pre>
          </mat-card-content>
        </mat-card>
      </div>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .header { display: flex; justify-content: space-between; align-items: center; }
      .full { width: 100%; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
      .entry-card mat-card-title { display: flex; align-items: center; gap: 8px; }
      .content { white-space: pre-wrap; word-wrap: break-word; font-family: 'Menlo', monospace; font-size: 13px; }
      .empty { text-align: center; padding: 64px 16px; color: #888; }
      .empty mat-icon { font-size: 48px; height: 48px; width: 48px; }
    `,
  ],
})
export class TeamContextComponent implements OnInit {
  entries: ContextEntry[] = [];
  showForm = false;
  newKey = '';
  newContent = '';
  newPinned = false;
  creating = false;

  private teamId!: string;

  constructor(private route: ActivatedRoute, private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh();
  }

  refresh(): void {
    this.studio.listContexts({ teamId: this.teamId, scope: 'TEAM' }).subscribe({
      next: (r) => (this.entries = r.entries),
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load context', 'OK', { duration: 4000 }),
    });
  }

  create(): void {
    if (!this.newKey.trim()) return;
    this.creating = true;
    this.studio
      .createContext({
        scope: 'TEAM',
        teamId: this.teamId,
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
          this.snack.open(err?.error?.error || 'Save failed', 'OK', { duration: 4000 });
        },
      });
  }
}

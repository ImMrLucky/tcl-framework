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
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { Mistake, MistakeSeverity } from '../agent-studio.types';

@Component({
  selector: 'app-team-rules',
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
    MatSelectModule,
    MatSnackBarModule,
  ],
  template: `
    <section class="page">
      <header class="header">
        <h2>Mistake & rule registry</h2>
        <button mat-flat-button color="primary" (click)="showForm = !showForm">
          <mat-icon>add</mat-icon>
          Add rule
        </button>
      </header>

      <mat-card *ngIf="showForm" class="create-card">
        <mat-card-title>Capture mistake → corrective rule</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Title</mat-label>
            <input matInput [(ngModel)]="newTitle" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>What happened</mat-label>
            <textarea matInput rows="3" [(ngModel)]="newDescription"></textarea>
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Corrective rule (the agent will read this every run)</mat-label>
            <textarea matInput rows="3" [(ngModel)]="newRule"></textarea>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Severity</mat-label>
            <mat-select [(ngModel)]="newSeverity">
              <mat-option value="LOW">Low</mat-option>
              <mat-option value="MEDIUM">Medium</mat-option>
              <mat-option value="HIGH">High</mat-option>
              <mat-option value="CRITICAL">Critical</mat-option>
            </mat-select>
          </mat-form-field>
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-button (click)="showForm = false">Cancel</button>
          <button mat-flat-button color="primary" (click)="create()" [disabled]="!newTitle.trim() || !newRule.trim() || creating">
            {{ creating ? 'Saving…' : 'Save' }}
          </button>
        </mat-card-actions>
      </mat-card>

      <div *ngIf="!mistakes.length" class="empty">
        <mat-icon>policy</mat-icon>
        <p>No rules yet. Capture mistakes here so the team learns from them.</p>
      </div>

      <mat-card *ngFor="let m of mistakes" class="mistake-card">
        <mat-card-title>
          {{ m.title }}
          <mat-chip [class]="'sev-' + m.severity.toLowerCase()" selected>{{ m.severity }}</mat-chip>
        </mat-card-title>
        <mat-card-content>
          <p class="muted" *ngIf="m.description"><strong>What happened:</strong> {{ m.description }}</p>
          <p><strong>Rule:</strong> {{ m.rule }}</p>
        </mat-card-content>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .header { display: flex; justify-content: space-between; align-items: center; }
      .full { width: 100%; }
      .mistake-card { background: #fff; }
      .mistake-card mat-card-title { display: flex; align-items: center; gap: 8px; }
      .empty { text-align: center; padding: 64px 16px; color: #888; }
      .empty mat-icon { font-size: 48px; height: 48px; width: 48px; }
      .muted { color: #666; }
      .sev-low      { background: #e3f2fd; }
      .sev-medium   { background: #fff8e1; }
      .sev-high     { background: #ffe0b2; }
      .sev-critical { background: #ffcdd2; }
    `,
  ],
})
export class TeamRulesComponent implements OnInit {
  mistakes: Mistake[] = [];
  showForm = false;
  newTitle = '';
  newDescription = '';
  newRule = '';
  newSeverity: MistakeSeverity = 'MEDIUM';
  creating = false;

  private teamId!: string;

  constructor(private route: ActivatedRoute, private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.teamId = this.route.snapshot.paramMap.get('teamId')!;
    this.refresh();
  }

  refresh(): void {
    this.studio.listMistakes({ teamId: this.teamId }).subscribe({
      next: (r) => (this.mistakes = r.mistakes),
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load rules', 'OK', { duration: 4000 }),
    });
  }

  create(): void {
    if (!this.newTitle.trim() || !this.newRule.trim()) return;
    this.creating = true;
    this.studio
      .createMistake({
        teamId: this.teamId,
        scope: 'TEAM',
        title: this.newTitle.trim(),
        description: this.newDescription.trim() || undefined,
        rule: this.newRule.trim(),
        severity: this.newSeverity,
      })
      .subscribe({
        next: () => {
          this.creating = false;
          this.showForm = false;
          this.newTitle = '';
          this.newDescription = '';
          this.newRule = '';
          this.newSeverity = 'MEDIUM';
          this.refresh();
        },
        error: (err) => {
          this.creating = false;
          this.snack.open(err?.error?.error || 'Save failed', 'OK', { duration: 4000 });
        },
      });
  }
}

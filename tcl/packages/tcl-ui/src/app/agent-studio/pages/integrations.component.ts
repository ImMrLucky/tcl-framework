import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { IntegrationRow } from '../agent-studio.types';

@Component({
  selector: 'app-as-integrations',
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
        <h2>Integrations</h2>
        <button mat-flat-button color="primary" (click)="showForm = !showForm">
          <mat-icon>add</mat-icon>
          New integration
        </button>
      </header>

      <p class="muted">
        Credentials are encrypted at rest. Use <strong>Test connection</strong> for Jira or Azure DevOps
        to verify credentials before sync work ships in <code>packages/agent-integrations</code>.
      </p>

      <mat-card *ngIf="showForm" class="create-card">
        <mat-card-title>Add integration</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Kind</mat-label>
            <mat-select [(ngModel)]="newKind">
              <mat-option value="jira">Jira</mat-option>
              <mat-option value="azure-devops">Azure DevOps</mat-option>
              <mat-option value="github">GitHub</mat-option>
              <mat-option value="gitlab">GitLab</mat-option>
              <mat-option value="linear">Linear</mat-option>
              <mat-option value="custom">Custom</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="newName" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>Base URL (config)</mat-label>
            <input matInput [(ngModel)]="newBaseUrl" placeholder="https://your-org.atlassian.net" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="full">
            <mat-label>API token / secret (encrypted at rest)</mat-label>
            <input matInput type="password" [(ngModel)]="newSecret" />
          </mat-form-field>
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-button (click)="showForm = false">Cancel</button>
          <button mat-flat-button color="primary" (click)="create()" [disabled]="!newName.trim() || creating">
            {{ creating ? 'Saving…' : 'Save' }}
          </button>
        </mat-card-actions>
      </mat-card>

      <div *ngIf="!integrations.length" class="empty">
        <mat-icon>link</mat-icon>
        <p>No integrations yet.</p>
      </div>

      <mat-card *ngFor="let i of integrations" class="i-card">
        <mat-card-title>
          {{ i.name }}
          <mat-chip>{{ i.kind }}</mat-chip>
          <mat-chip [color]="i.status === 'READY' ? 'primary' : 'warn'" selected>{{ i.status }}</mat-chip>
        </mat-card-title>
        <mat-card-content>
          <p class="muted" *ngIf="i.last_synced_at">Last sync: {{ i.last_synced_at | date: 'medium' }}</p>
          <p class="warn" *ngIf="i.last_error">{{ i.last_error }}</p>
        </mat-card-content>
        <mat-card-actions align="end">
          <button
            mat-stroked-button
            *ngIf="i.kind === 'jira' || i.kind === 'azure-devops'"
            (click)="ping(i)"
            [disabled]="pingingId === i.id"
          >
            <mat-icon>cable</mat-icon>
            {{ pingingId === i.id ? 'Testing…' : 'Test connection' }}
          </button>
        </mat-card-actions>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .header { display: flex; justify-content: space-between; align-items: center; }
      .full { width: 100%; }
      .i-card { background: #fff; }
      .i-card mat-card-title { display: flex; align-items: center; gap: 8px; }
      .empty { text-align: center; padding: 64px 16px; color: #888; }
      .empty mat-icon { font-size: 48px; height: 48px; width: 48px; }
      .muted { color: #666; }
      .warn { color: #d32f2f; }
    `,
  ],
})
export class IntegrationsComponent implements OnInit {
  integrations: IntegrationRow[] = [];
  showForm = false;
  newKind: 'jira' | 'azure-devops' | 'github' | 'gitlab' | 'linear' | 'custom' = 'jira';
  newName = '';
  newBaseUrl = '';
  newSecret = '';
  creating = false;
  pingingId: string | null = null;

  constructor(private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.studio.listIntegrations().subscribe({
      next: (r) => (this.integrations = r.integrations),
      error: (err) => this.snack.open(err?.error?.error || 'Failed to load integrations', 'OK', { duration: 4000 }),
    });
  }

  ping(i: IntegrationRow): void {
    if (i.kind !== 'jira' && i.kind !== 'azure-devops') return;
    this.pingingId = i.id;
    this.studio.pingIntegration(i.id).subscribe({
      next: (res) => {
        this.pingingId = null;
        if (res.ok) {
          this.snack.open(`Connection OK (${res.provider})`, 'OK', { duration: 4000 });
        } else {
          this.snack.open('Connection check returned not OK', 'OK', { duration: 4000 });
        }
        this.refresh();
      },
      error: (err) => {
        this.pingingId = null;
        const msg = err?.error?.error || err?.error?.message || err?.message || 'Ping failed';
        this.snack.open(String(msg), 'OK', { duration: 6000 });
      },
    });
  }

  create(): void {
    if (!this.newName.trim()) return;
    this.creating = true;
    this.studio
      .createIntegration({
        kind: this.newKind,
        name: this.newName.trim(),
        config: this.newBaseUrl ? { baseUrl: this.newBaseUrl } : {},
        credentials: this.newSecret ? { token: this.newSecret } : undefined,
      })
      .subscribe({
        next: () => {
          this.creating = false;
          this.showForm = false;
          this.newName = '';
          this.newBaseUrl = '';
          this.newSecret = '';
          this.refresh();
        },
        error: (err) => {
          this.creating = false;
          this.snack.open(err?.error?.error || 'Save failed', 'OK', { duration: 4000 });
        },
      });
  }
}

import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { AgentStudioService } from '../agent-studio.service';

@Component({
  selector: 'app-manage-agent-files',
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatButtonModule, MatChipsModule],
  template: `
    <section class="page">
      <a mat-button routerLink="/agent-studio/templates">← Templates hub</a>
      <h2>Reusable file templates</h2>
      <p class="muted">
        Org-level template assets (e.g. shared <code>rules.md</code> snippets) will list here after migration 050 and when you create rows via API.
        Default per-agent files are seeded from <code>packages/agent-core/templates/assets/generic/</code> when an agent is created.
      </p>
      <div class="grid" *ngIf="assets.length; else empty">
        <mat-card *ngFor="let a of assets" class="card">
            <mat-card-title>{{ $any(a).name }}</mat-card-title>
          <mat-card-subtitle>{{ $any(a).key }} · {{ $any(a).asset_type }}</mat-card-subtitle>
          <mat-card-content>
            <mat-chip *ngIf="$any(a).is_system" selected>system</mat-chip>
            <pre class="md">{{ $any(a).markdown | slice : 0 : 400 }}</pre>
          </mat-card-content>
        </mat-card>
      </div>
      <ng-template #empty>
        <mat-card><mat-card-content>No template assets in the database yet.</mat-card-content></mat-card>
      </ng-template>
    </section>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .muted {
        color: #64748b;
        max-width: 800px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 12px;
      }
      .card {
        background: #fff;
      }
      .md {
        font-size: 11px;
        white-space: pre-wrap;
      }
    `,
  ],
})
export class ManageAgentFilesComponent implements OnInit {
  assets: unknown[] = [];

  constructor(private studio: AgentStudioService) {}

  ngOnInit(): void {
    this.studio.listTemplateAssets().subscribe({ next: (r) => (this.assets = r.assets) });
  }
}

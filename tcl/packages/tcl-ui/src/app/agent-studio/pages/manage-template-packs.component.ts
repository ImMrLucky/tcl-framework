import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { AgentStudioService } from '../agent-studio.service';
import { TemplatePackRow } from '../agent-studio.types';

@Component({
  selector: 'app-manage-template-packs',
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatChipsModule, MatButtonModule],
  template: `
    <section class="page">
      <a mat-button routerLink="/agent-studio/templates">← Templates hub</a>
      <h2>Template packs</h2>
      <p class="muted">
        Workflow packs and agent template bundles. System packs are read-only in the database; clone into a custom org pack to edit (API next).
      </p>
      <div class="grid">
        <mat-card *ngFor="let p of packs" class="card">
          <mat-card-title>{{ p.name }}</mat-card-title>
          <mat-card-subtitle>{{ p.key }} · {{ p.pack_type }}</mat-card-subtitle>
          <mat-card-content>
            <p>{{ p.description }}</p>
            <mat-chip *ngIf="p.is_system" selected>system</mat-chip>
            <mat-chip *ngIf="!p.is_system">custom</mat-chip>
          </mat-card-content>
        </mat-card>
      </div>
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
        max-width: 720px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
      }
      .card {
        background: #fff;
      }
    `,
  ],
})
export class ManageTemplatePacksComponent implements OnInit {
  packs: TemplatePackRow[] = [];

  constructor(private studio: AgentStudioService) {}

  ngOnInit(): void {
    this.studio.listTemplatePacks().subscribe({ next: (r) => (this.packs = r.packs) });
  }
}

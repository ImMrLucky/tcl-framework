import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonModule } from '@angular/material/button';
import { AgentStudioService } from '../agent-studio.service';
import { RoleTemplate } from '../agent-studio.types';

@Component({
  selector: 'app-manage-roles',
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatChipsModule, MatButtonModule],
  template: `
    <section class="page">
      <a mat-button routerLink="/agent-studio/templates">← Templates hub</a>
      <h2>Roles</h2>
      <p class="muted">
        <strong>Role</strong> is job function (what the agent does). Personas are separate (how the agent behaves). Built-in roles ship from
        <code>packages/agent-core/templates/roles.json</code>; database roles appear when you add org-specific templates (migration 050).
      </p>
      <h3>Builtin catalog</h3>
      <div class="grid">
        <mat-card *ngFor="let r of catalog" class="card">
          <mat-card-title>{{ r.name }}</mat-card-title>
          <mat-card-subtitle>{{ r.key }}</mat-card-subtitle>
          <mat-card-content>
            <p>{{ r.description }}</p>
            <mat-chip-set>
              <mat-chip *ngFor="let c of r.defaultCapabilities">{{ c }}</mat-chip>
            </mat-chip-set>
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
        max-width: 800px;
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
export class ManageRolesComponent implements OnInit {
  catalog: RoleTemplate[] = [];

  constructor(private studio: AgentStudioService) {}

  ngOnInit(): void {
    // Builtin catalog is served from `agent-core` JSON (same as templates hub). Use the
    // public `/templates/roles` route so this page is not empty when `/roles` RBAC fails.
    this.studio.listRoleTemplates().subscribe({ next: (r) => (this.catalog = r.templates) });
  }
}

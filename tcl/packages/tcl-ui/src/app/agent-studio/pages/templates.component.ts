import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { AgentStudioService } from '../agent-studio.service';
import { RoleTemplate, WorkflowTemplate } from '../agent-studio.types';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatChipsModule, MatTabsModule, MatIconModule],
  template: `
    <section class="page">
      <h2>Templates</h2>
      <p class="muted">
        Seeded templates from <code>packages/agent-core/templates/</code>. Use these
        as starting points when creating teams and agents.
      </p>

      <mat-tab-group>
        <mat-tab label="Roles">
          <div class="grid">
            <mat-card *ngFor="let r of roles" class="t-card">
              <mat-card-title>
                {{ r.name }}
                <mat-chip *ngIf="r.isOrchestrator" color="primary" selected>orchestrator</mat-chip>
              </mat-card-title>
              <mat-card-subtitle>{{ r.key }}</mat-card-subtitle>
              <mat-card-content>
                <p>{{ r.description }}</p>
                <p class="persona"><em>{{ r.defaultPersona }}</em></p>
                <mat-chip-set>
                  <mat-chip *ngFor="let c of r.defaultCapabilities">{{ c }}</mat-chip>
                </mat-chip-set>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

        <mat-tab label="Workflows">
          <div class="grid">
            <mat-card *ngFor="let w of workflows" class="t-card">
              <mat-card-title>{{ w.name }}</mat-card-title>
              <mat-card-subtitle>{{ w.key }}</mat-card-subtitle>
              <mat-card-content>
                <p>{{ w.description }}</p>
                <h4>Default columns</h4>
                <mat-chip-set>
                  <mat-chip *ngFor="let c of w.defaultBoardColumns">{{ c.label }}</mat-chip>
                </mat-chip-set>
                <h4>Recommended roles</h4>
                <mat-chip-set>
                  <mat-chip *ngFor="let r of w.recommendedRoles">{{ r }}</mat-chip>
                </mat-chip-set>
                <h4>Review gates</h4>
                <ul>
                  <li *ngFor="let g of w.reviewGates">
                    After <strong>{{ g.afterColumnKey }}</strong>: {{ g.gateType }}
                    <span *ngIf="g.requiredRole">(requires {{ g.requiredRole }})</span>
                  </li>
                </ul>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>
      </mat-tab-group>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; padding-top: 16px; }
      .t-card { background: #fff; }
      .t-card mat-card-title { display: flex; align-items: center; gap: 8px; }
      .persona { color: #666; }
      h4 { margin-bottom: 4px; margin-top: 12px; }
      .muted { color: #666; }
    `,
  ],
})
export class TemplatesComponent implements OnInit {
  roles: RoleTemplate[] = [];
  workflows: WorkflowTemplate[] = [];

  constructor(private studio: AgentStudioService) {}

  ngOnInit(): void {
    this.studio.listRoleTemplates().subscribe({ next: (r) => (this.roles = r.templates) });
    this.studio.listWorkflowTemplates().subscribe({ next: (r) => (this.workflows = r.templates) });
  }
}

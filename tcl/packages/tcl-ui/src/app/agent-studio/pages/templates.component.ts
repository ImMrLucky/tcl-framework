import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AgentStudioService } from '../agent-studio.service';
import { PersonaTemplate, RoleTemplate, WorkflowTemplate } from '../agent-studio.types';

@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatChipsModule,
    MatTabsModule,
    MatIconModule,
    MatButtonModule,
  ],
  template: `
    <section class="page">
      <h2>Templates & packs</h2>
      <p class="muted">
        Agent Studio is a <strong>generic</strong> agent platform: roles, personas, Markdown agent files, and workflow packs are composable.
        <strong>BMAD Workflow Pack</strong> is one optional pack—not the default assumption for the whole product.
      </p>
      <div class="hub">
        <a mat-stroked-button routerLink="/agent-studio/templates/packs">Manage template packs</a>
        <a mat-stroked-button routerLink="/agent-studio/templates/roles">Manage roles</a>
        <a mat-stroked-button routerLink="/agent-studio/templates/personas">Manage personas</a>
        <a mat-stroked-button routerLink="/agent-studio/templates/files">Manage agent file templates</a>
      </div>

      <mat-tab-group>
        <mat-tab label="Roles (builtin catalog)">
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

        <mat-tab label="Personas (builtin catalog)">
          <div class="grid">
            <mat-card *ngFor="let p of personas" class="t-card">
              <mat-card-title>{{ p.name }}</mat-card-title>
              <mat-card-subtitle>{{ p.key }}</mat-card-subtitle>
              <mat-card-content>
                <p>{{ p.description }}</p>
                <p class="persona"><em>{{ p.personaMarkdown }}</em></p>
              </mat-card-content>
            </mat-card>
          </div>
        </mat-tab>

        <mat-tab label="Workflow templates">
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
      .page {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .hub {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
        padding-top: 16px;
      }
      .t-card {
        background: #fff;
      }
      .t-card mat-card-title {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .persona {
        color: #666;
      }
      h4 {
        margin-bottom: 4px;
        margin-top: 12px;
      }
      .muted {
        color: #666;
        max-width: 900px;
      }
    `,
  ],
})
export class TemplatesComponent implements OnInit {
  roles: RoleTemplate[] = [];
  personas: PersonaTemplate[] = [];
  workflows: WorkflowTemplate[] = [];

  constructor(private studio: AgentStudioService) {}

  ngOnInit(): void {
    this.studio.listRoleTemplates().subscribe({ next: (r) => (this.roles = r.templates) });
    this.studio.listPersonaTemplates().subscribe({ next: (r) => (this.personas = r.templates) });
    this.studio.listWorkflowTemplates().subscribe({ next: (r) => (this.workflows = r.templates) });
  }
}

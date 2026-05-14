import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { AgentStudioService } from '../agent-studio.service';
import { PersonaTemplate } from '../agent-studio.types';

@Component({
  selector: 'app-manage-personas',
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatButtonModule],
  template: `
    <section class="page">
      <a mat-button routerLink="/agent-studio/templates">← Templates hub</a>
      <h2>Personas</h2>
      <p class="muted">
        <strong>Persona</strong> is behavior and communication style, not job title. Pair a role (job) with a persona (style)—for example Senior Software Engineer + Startup MVP Builder.
      </p>
      <div class="grid">
        <mat-card *ngFor="let p of personas" class="card">
          <mat-card-title>{{ p.name }}</mat-card-title>
          <mat-card-subtitle>{{ p.key }}</mat-card-subtitle>
          <mat-card-content>
            <p>{{ p.description }}</p>
            <pre class="md">{{ p.personaMarkdown }}</pre>
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
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 12px;
      }
      .card {
        background: #fff;
      }
      .md {
        white-space: pre-wrap;
        font-size: 12px;
        background: #f8fafc;
        padding: 8px;
        border-radius: 6px;
      }
    `,
  ],
})
export class ManagePersonasComponent implements OnInit {
  personas: PersonaTemplate[] = [];

  constructor(private studio: AgentStudioService) {}

  ngOnInit(): void {
    this.studio.listPersonasCatalog().subscribe({ next: (r) => (this.personas = r.catalog) });
  }
}

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
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { AgentStudioSettings, McpServerRow, ProviderKeyRow, RoutingRule } from '../agent-studio.types';

@Component({
  selector: 'app-as-settings',
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
    MatTabsModule,
    MatSnackBarModule,
  ],
  template: `
    <section class="page">
      <h2>Studio settings</h2>

      <mat-tab-group>
        <!-- Org-level settings -->
        <mat-tab label="General">
          <mat-card class="card" *ngIf="settings">
            <mat-card-title>Defaults</mat-card-title>
            <mat-card-content>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Default model</mat-label>
                <input matInput [(ngModel)]="defaultModel" placeholder="e.g. anthropic/claude-sonnet-4" />
              </mat-form-field>
            </mat-card-content>
            <mat-card-actions align="end">
              <button mat-flat-button color="primary" (click)="saveSettings()">Save</button>
            </mat-card-actions>
          </mat-card>
        </mat-tab>

        <!-- Provider keys (BYOK) -->
        <mat-tab label="Provider keys (BYOK)">
          <mat-card class="card">
            <mat-card-title>Add provider key</mat-card-title>
            <mat-card-subtitle>
              Encrypted at rest with AES-256-GCM. The full key is never returned over the wire.
            </mat-card-subtitle>
            <mat-card-content>
              <div class="row">
                <mat-form-field appearance="outline">
                  <mat-label>Provider</mat-label>
                  <mat-select [(ngModel)]="newProvider">
                    <mat-option value="openai">OpenAI</mat-option>
                    <mat-option value="anthropic">Anthropic</mat-option>
                    <mat-option value="google">Google</mat-option>
                    <mat-option value="azure-openai">Azure OpenAI</mat-option>
                    <mat-option value="mistral">Mistral</mat-option>
                    <mat-option value="groq">Groq</mat-option>
                    <mat-option value="ollama">Ollama</mat-option>
                    <mat-option value="custom">Custom</mat-option>
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Label</mat-label>
                  <input matInput [(ngModel)]="newLabel" placeholder="prod-key" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="grow">
                  <mat-label>Secret</mat-label>
                  <input matInput type="password" [(ngModel)]="newSecret" />
                </mat-form-field>
              </div>
            </mat-card-content>
            <mat-card-actions align="end">
              <button
                mat-flat-button
                color="primary"
                [disabled]="!newProvider || !newLabel || !newSecret || creatingKey"
                (click)="addKey()"
              >
                {{ creatingKey ? 'Saving…' : 'Save key' }}
              </button>
            </mat-card-actions>
          </mat-card>

          <mat-card class="card">
            <mat-card-title>Stored keys</mat-card-title>
            <mat-card-content>
              <p *ngIf="!keys.length" class="muted">No keys yet.</p>
              <div class="key-row" *ngFor="let k of keys">
                <div>
                  <strong>{{ k.label }}</strong>
                  <mat-chip>{{ k.provider }}</mat-chip>
                  <span class="muted">v{{ k.key_version }}</span>
                </div>
                <div class="key-actions">
                  <button mat-stroked-button (click)="reveal(k)">
                    <mat-icon>visibility</mat-icon>
                    {{ revealed[k.id] || 'Reveal' }}
                  </button>
                  <button mat-icon-button color="warn" (click)="deleteKey(k)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>
            </mat-card-content>
          </mat-card>
        </mat-tab>

        <!-- Model routing -->
        <mat-tab label="Model routing">
          <mat-card class="card">
            <mat-card-title>Routing rules</mat-card-title>
            <mat-card-subtitle>
              Most-specific scope wins: AGENT > TEAM > ORG.
            </mat-card-subtitle>
            <mat-card-content>
              <p *ngIf="!rules.length" class="muted">No rules yet.</p>
              <table *ngIf="rules.length" class="rules-table">
                <thead>
                  <tr>
                    <th>Scope</th><th>Use case</th><th>Provider</th><th>Model</th><th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let r of rules">
                    <td>{{ r.scope }}</td>
                    <td>{{ r.use_case }}</td>
                    <td>{{ r.provider }}</td>
                    <td>{{ r.model }}</td>
                    <td>{{ r.is_active ? 'yes' : 'no' }}</td>
                  </tr>
                </tbody>
              </table>
            </mat-card-content>
          </mat-card>
        </mat-tab>

        <!-- MCP servers -->
        <mat-tab label="MCP servers">
          <mat-card class="card">
            <mat-card-title>Configured MCP servers</mat-card-title>
            <mat-card-content>
              <p *ngIf="!mcpServers.length" class="muted">No MCP servers configured.</p>
              <div class="key-row" *ngFor="let s of mcpServers">
                <div>
                  <strong>{{ s.name }}</strong>
                  <mat-chip>{{ s.transport }}</mat-chip>
                  <span class="muted">{{ s.command || s.url }}</span>
                </div>
              </div>
            </mat-card-content>
          </mat-card>
        </mat-tab>
      </mat-tab-group>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .card { background: #fff; margin-top: 16px; }
      .full { width: 100%; }
      .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
      .grow { min-width: 240px; }
      .key-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid #f0f0f0;
        gap: 12px;
      }
      .key-row strong { margin-right: 8px; }
      .key-actions { display: flex; gap: 8px; align-items: center; }
      .muted { color: #666; margin-left: 4px; }
      .rules-table { width: 100%; border-collapse: collapse; }
      .rules-table th, .rules-table td { padding: 8px; border-bottom: 1px solid #eee; text-align: left; }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  settings: AgentStudioSettings | null = null;
  defaultModel = '';

  keys: ProviderKeyRow[] = [];
  newProvider = 'openai';
  newLabel = '';
  newSecret = '';
  creatingKey = false;
  revealed: Record<string, string> = {};

  rules: RoutingRule[] = [];
  mcpServers: McpServerRow[] = [];

  constructor(private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.studio.getSettings().subscribe({
      next: (r) => {
        this.settings = r.settings;
        this.defaultModel = r.settings?.default_model ?? '';
      },
    });
    this.refreshKeys();
    this.studio.listRoutingRules().subscribe({ next: (r) => (this.rules = r.rules) });
    this.studio.listMcpServers().subscribe({ next: (r) => (this.mcpServers = r.servers) });
  }

  refreshKeys(): void {
    this.studio.listProviderKeys().subscribe({ next: (r) => (this.keys = r.keys) });
  }

  saveSettings(): void {
    this.studio.updateSettings({ defaultModel: this.defaultModel }).subscribe({
      next: () => this.snack.open('Saved.', 'OK', { duration: 2500 }),
      error: (err) => this.snack.open(err?.error?.error || 'Save failed', 'OK', { duration: 4000 }),
    });
  }

  addKey(): void {
    if (!this.newProvider || !this.newLabel || !this.newSecret) return;
    this.creatingKey = true;
    this.studio.createProviderKey({ provider: this.newProvider, label: this.newLabel, secret: this.newSecret }).subscribe({
      next: () => {
        this.creatingKey = false;
        this.newLabel = '';
        this.newSecret = '';
        this.refreshKeys();
      },
      error: (err) => {
        this.creatingKey = false;
        this.snack.open(err?.error?.error || err?.error?.message || 'Save failed', 'OK', { duration: 4000 });
      },
    });
  }

  reveal(key: ProviderKeyRow): void {
    this.studio.revealProviderKey(key.id).subscribe({
      next: (r) => (this.revealed[key.id] = r.preview),
      error: (err) => this.snack.open(err?.error?.error || 'Reveal failed', 'OK', { duration: 4000 }),
    });
  }

  deleteKey(key: ProviderKeyRow): void {
    if (!window.confirm(`Delete provider key "${key.label}"?`)) return;
    this.studio.deleteProviderKey(key.id).subscribe({ next: () => this.refreshKeys() });
  }
}

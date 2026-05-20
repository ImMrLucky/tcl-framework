import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AgentStudioService } from '../agent-studio.service';
import { LocalRunner, LocalVendorRef } from '../agent-studio.types';
import { migrationBannerText, responseNeedsMigration, migrationErrorText } from '../agent-studio-migration.util';

@Component({
  selector: 'app-vendors-runtime',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatExpansionModule,
    MatSnackBarModule,
  ],
  template: `
    <section class="page">
      <header class="header">
        <h2>Vendors &amp; Runtime</h2>
        <p class="muted">
          Keys live in your local Agent Runner vault by default. ProtectQA stores metadata only — never plaintext API keys.
        </p>
      </header>

      <mat-card *ngIf="migrationWarning" class="warn-card">
        <mat-card-content>
          <mat-icon>warning</mat-icon>
          <p>{{ migrationWarning }}</p>
        </mat-card-content>
      </mat-card>

      <mat-card class="hero">
        <mat-card-title>Local-first execution (default)</mat-card-title>
        <mat-card-content>
          <mat-chip color="primary" selected>LOCAL_RUNNER_DEFAULT</mat-chip>
          <p>
            ProtectQA is the <strong>control plane</strong> (teams, board, runs, audit). Your machine is the
            <strong>execution plane</strong> — models, tools, and keys never leave the runner unless you opt into cloud
            dispatch.
          </p>
          <p class="muted small">
            Server-side <code>/dispatch</code> and Settings provider keys are optional cloud mode only.
          </p>
        </mat-card-content>
      </mat-card>

      <mat-card class="install-guide" id="what-to-install">
        <mat-card-title>What you need to install</mat-card-title>
        <mat-card-subtitle>Most Agent Studio users do not install anything from npm.</mat-card-subtitle>
        <mat-card-content>
          <table class="pkg-table">
            <thead>
              <tr>
                <th>How you use Agent Studio</th>
                <th>npm packages</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Browser only</strong> — teams, board, IDE, TCL Insights on ProtectQA
                </td>
                <td><span class="none">None</span> — this web app talks to our hosted API</td>
              </tr>
              <tr class="highlight-row">
                <td>
                  <strong>Local autonomous runs</strong> — your API keys stay on your machine (recommended)
                </td>
                <td>
                  <code>&#64;protectqa/agent-runner-local</code> only
                </td>
              </tr>
              <tr>
                <td><strong>Cloud dispatch only</strong> — optional BYOK keys in Studio Settings</td>
                <td><span class="none">None</span> — configure keys in Settings, not npm</td>
              </tr>
              <tr>
                <td><strong>Embed TCL in your own product</strong> — developers integrating the engine</td>
                <td><code>&#64;protectqa/tcl-sdk</code> + <code>&#64;protectqa/tcl-core</code></td>
              </tr>
            </tbody>
          </table>
        </mat-card-content>
      </mat-card>

      <mat-expansion-panel class="npm-explainer" id="npm-packages">
        <mat-expansion-panel-header>
          <mat-panel-title>Why are there many &#64;protectqa packages on npm?</mat-panel-title>
          <mat-panel-description>Internal monorepo vs what customers install</mat-panel-description>
        </mat-expansion-panel-header>
        <p>
          ProtectQA publishes a <strong>monorepo</strong> of libraries. Only a few are meant for end users; the rest
          are building blocks our server and tools depend on (same repo, public for transparency and self-hosting).
        </p>
        <div class="pkg-columns">
          <div class="pkg-col">
            <h4>Customer-facing</h4>
            <ul>
              <li><code>&#64;protectqa/agent-runner-local</code> — local CLI (pair, keys, start)</li>
              <li><code>&#64;protectqa/tcl-sdk</code> — TCL in your codebase</li>
              <li><code>&#64;protectqa/tcl-core</code> — engine (usually via SDK)</li>
              <li><code>&#64;protectqa/tcl-browser-runner</code> — optional TCL live dashboard</li>
            </ul>
          </div>
          <div class="pkg-col">
            <h4>Internal / operator</h4>
            <p class="muted small">You do not install these for normal Agent Studio.</p>
            <ul>
              <li><code>&#64;protectqa/agent-core</code>, <code>agent-context</code>, … — agent contracts</li>
              <li><code>&#64;protectqa/tcl-ui</code> — this web app (we host it)</li>
              <li><code>&#64;protectqa/tcl-integrations</code>, <code>tcl-nli-*</code> — services we run</li>
            </ul>
          </div>
        </div>
        <p class="muted small">
          If you self-host ProtectQA, operators deploy <code>tcl-core</code> + <code>tcl-ui</code> from source or
          Docker — not the typical SaaS customer path.
        </p>
      </mat-expansion-panel>

      <mat-card>
        <mat-card-title>Runtime setup wizard</mat-card-title>
        <mat-card-content>
          <ol class="wizard">
            <li><code>npx &#64;protectqa/agent-runner-local setup</code></li>
            <li>Generate pairing code below, then <code>npx &#64;protectqa/agent-runner-local pair</code></li>
            <li><code>npx &#64;protectqa/agent-runner-local login</code> (optional user session for UI sync)</li>
            <li><code>npx &#64;protectqa/agent-runner-local add-key openai</code> (keys stay local)</li>
            <li><code>npx &#64;protectqa/agent-runner-local register-vendors</code></li>
            <li><code>npx &#64;protectqa/agent-runner-local start</code></li>
          </ol>
        </mat-card-content>
      </mat-card>

      <mat-card>
        <mat-card-title>Local runner</mat-card-title>
        <mat-card-content>
          <button mat-flat-button color="primary" (click)="pairRunner()" [disabled]="pairing">
            {{ pairing ? 'Generating…' : 'Generate pairing code' }}
          </button>
          <p *ngIf="pairingCode" class="code">Pairing code: <strong>{{ pairingCode }}</strong></p>
          <ul class="list">
            <li *ngFor="let r of runners">
              {{ r.name }} — <mat-chip>{{ r.status }}</mat-chip>
              <span class="muted" *ngIf="r.last_seen_at">seen {{ r.last_seen_at | date: 'short' }}</span>
            </li>
          </ul>
          <p class="muted" *ngIf="!runners.length">No runners paired yet.</p>
        </mat-card-content>
      </mat-card>

      <mat-card>
        <mat-card-title>Local vendor refs</mat-card-title>
        <mat-card-content>
          <ul class="list">
            <li *ngFor="let v of vendors">
              <strong>{{ v.provider }}</strong> / {{ v.label }}
              <mat-chip>{{ v.status }}</mat-chip>
              <span class="muted" *ngIf="v.key_preview">{{ v.key_preview }}</span>
            </li>
          </ul>
          <p class="muted" *ngIf="!vendors.length">
            Register vendors from the local CLI: <code>agent-runner-local add-key openai</code>
          </p>
        </mat-card-content>
      </mat-card>
    </section>
  `,
  styles: [
    `
      .page { display: flex; flex-direction: column; gap: 16px; }
      .hero { border-left: 4px solid #6366f1; }
      .wizard { margin: 0; padding-left: 20px; line-height: 1.8; }
      .wizard code { font-size: 12px; }
      .header h2 { margin: 0 0 4px; }
      .muted { color: #64748b; }
      .small { font-size: 13px; }
      .list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .code { margin-top: 12px; padding: 12px; background: #f1f5f9; border-radius: 8px; }
      .warn-card mat-card-content {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        background: #fffbeb;
        color: #92400e;
        font-size: 14px;
      }
      .warn-card mat-icon { color: #d97706; }
      .install-guide { border-left: 4px solid #10b981; }
      .pkg-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      .pkg-table th,
      .pkg-table td {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid #e2e8f0;
        vertical-align: top;
      }
      .pkg-table th { color: #475569; font-weight: 600; }
      .pkg-table code { font-size: 12px; }
      .highlight-row { background: #f0fdf4; }
      .none { color: #64748b; font-style: italic; }
      .npm-explainer {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #fff;
      }
      .npm-explainer p { margin: 0 0 12px; font-size: 14px; line-height: 1.5; }
      .pkg-columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-bottom: 12px;
      }
      @media (max-width: 720px) {
        .pkg-columns { grid-template-columns: 1fr; }
      }
      .pkg-col h4 { margin: 0 0 8px; font-size: 14px; }
      .pkg-col ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6; }
      .pkg-col code { font-size: 11px; }
    `,
  ],
})
export class VendorsRuntimeComponent implements OnInit {
  runners: LocalRunner[] = [];
  vendors: LocalVendorRef[] = [];
  pairing = false;
  pairingCode: string | null = null;
  migrationWarning: string | null = null;

  constructor(private studio: AgentStudioService, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.studio.listLocalRunners().subscribe({
      next: (r) => {
        this.runners = r.runners ?? [];
        if (responseNeedsMigration(r)) this.migrationWarning = migrationBannerText(r);
      },
      error: (err) => {
        const msg = migrationErrorText(err);
        if (msg) this.migrationWarning = msg;
      },
    });
    this.studio.listLocalVendors().subscribe({
      next: (r) => {
        this.vendors = r.vendors ?? [];
        if (responseNeedsMigration(r)) this.migrationWarning = migrationBannerText(r);
      },
      error: (err) => {
        const msg = migrationErrorText(err);
        if (msg) this.migrationWarning = msg;
      },
    });
  }

  pairRunner(): void {
    this.pairing = true;
    this.studio.createLocalRunnerPairingCode('My Mac').subscribe({
      next: (r) => {
        this.pairing = false;
        this.pairingCode = r.pairingCode;
        this.refresh();
        this.snack.open('Enter this code in agent-runner-local pair', 'OK', { duration: 6000 });
      },
      error: (err) => {
        this.pairing = false;
        const msg = migrationErrorText(err) ?? 'Failed to create pairing code';
        this.snack.open(msg, 'OK', { duration: 8000 });
      },
    });
  }
}

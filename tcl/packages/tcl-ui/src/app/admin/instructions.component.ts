import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-admin-instructions',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    <div class="instructions-container">
      <div class="header">
        <button mat-button routerLink="/admin">
          <mat-icon>arrow_back</mat-icon>
          Back to Admin Dashboard
        </button>
        <h1>Admin Instructions</h1>
      </div>

      <mat-card>
        <mat-card-content>
          <div class="markdown-content">
            <h2>Superuser Guide</h2>
            
            <h3>Getting Started</h3>
            <p>As a superuser, you have access to special admin features for testing and managing the platform.</p>

            <h3>Admin Dashboard</h3>
            <p>Access the admin dashboard at <code>/admin</code>. It includes three main tabs:</p>
            <ul>
              <li><strong>Org Switch</strong>: Switch between organizations you have access to</li>
              <li><strong>Emulation</strong>: Temporarily override plan tier for testing (session-only)</li>
              <li><strong>Internal Test Orgs</strong>: Manage plan tiers for internal test organizations</li>
            </ul>

            <h3>Organization Switching</h3>
            <p>Use the "Org Switch" tab to change which organization you're currently viewing. This is useful for:</p>
            <ul>
              <li>Testing different plan tiers</li>
              <li>Accessing internal test organizations</li>
              <li>Managing multiple organizations</li>
            </ul>
            <p><strong>Note:</strong> After switching, you may need to refresh the page to see changes.</p>

            <h3>Plan Tier Emulation</h3>
            <p>Emulation allows you to temporarily test how the platform behaves with different plan tiers without changing the actual organization plan.</p>
            <ul>
              <li>Emulation is <strong>session-only</strong> - it doesn't persist after logout</li>
              <li>Emulation does <strong>not</strong> modify the database or Stripe</li>
              <li>Useful for testing feature gating and limits</li>
            </ul>
            <p><strong>How to use:</strong></p>
            <ol>
              <li>Go to Admin Dashboard → Emulation tab</li>
              <li>Select a plan tier to emulate</li>
              <li>Click "Enable Emulation"</li>
              <li>Your session will now behave as if you have that plan tier</li>
              <li>Click "Disable Emulation" when done</li>
            </ol>

            <h3>Internal Test Organizations</h3>
            <p>Internal test organizations are special organizations marked with <code>is_internal_test = true</code>. These are:</p>
            <ul>
              <li>Created by the seed script (<code>022_seed_internal_test_orgs.sql</code>)</li>
              <li>Set to <code>billing_mode = 'COMPED'</code> (no Stripe billing)</li>
              <li>Safe to modify plan tiers for testing</li>
            </ul>
            <p><strong>Available test orgs:</strong></p>
            <ul>
              <li>ProtectQA Internal Sandbox (SANDBOX tier)</li>
              <li>ProtectQA Internal Team (TEAM tier)</li>
              <li>ProtectQA Internal Enterprise (ENTERPRISE tier)</li>
            </ul>
            <p>You can change their plan tiers using the "Internal Test Orgs" tab in the admin dashboard.</p>

            <h3>Security Notes</h3>
            <ul>
              <li>Superuser features are only available to users with <code>role = 'SUPERUSER'</code> in the <code>profiles</code> table</li>
              <li>All admin actions are logged to <code>admin_audit_log</code> for audit purposes</li>
              <li>Emulation never mutates the database or Stripe</li>
              <li>Only internal test orgs can have their plans changed via the admin UI</li>
            </ul>

            <h3>Troubleshooting</h3>
            <p><strong>I don't see admin controls:</strong></p>
            <ul>
              <li>Verify your role is <code>SUPERUSER</code> in the database</li>
              <li>Check that <code>/api/me</code> returns <code>"isSuperuser": true</code></li>
              <li>Refresh the page after becoming a superuser</li>
            </ul>

            <p><strong>Org switching doesn't work:</strong></p>
            <ul>
              <li>Make sure you're a member of the organization you're trying to switch to</li>
              <li>Check backend logs for errors</li>
              <li>Try refreshing the page after switching</li>
            </ul>

            <p><strong>Emulation not working:</strong></p>
            <ul>
              <li>Check that emulation is enabled in the Admin Dashboard</li>
              <li>Verify the plan context is reloading (check <code>/api/me</code> response)</li>
              <li>Try disabling and re-enabling emulation</li>
            </ul>

            <h3>API Endpoints</h3>
            <p>Admin endpoints (superuser only):</p>
            <ul>
              <li><code>GET /api/orgs</code> - List orgs you can access</li>
              <li><code>GET /api/admin/orgs</code> - List all orgs (superuser only)</li>
              <li><code>POST /api/admin/switch-org</code> - Switch active organization</li>
              <li><code>POST /api/admin/emulation</code> - Enable emulation</li>
              <li><code>DELETE /api/admin/emulation</code> - Disable emulation</li>
              <li><code>POST /api/admin/internal-org/plan</code> - Set plan for internal test org</li>
            </ul>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .instructions-container {
      padding: 24px;
      max-width: 900px;
      margin: 0 auto;
    }

    .header {
      margin-bottom: 24px;
    }

    .header h1 {
      margin-top: 16px;
      margin-bottom: 8px;
    }

    .markdown-content {
      line-height: 1.6;
    }

    .markdown-content h2 {
      margin-top: 32px;
      margin-bottom: 16px;
      color: #1976d2;
    }

    .markdown-content h3 {
      margin-top: 24px;
      margin-bottom: 12px;
      color: #424242;
    }

    .markdown-content ul,
    .markdown-content ol {
      margin: 16px 0;
      padding-left: 32px;
    }

    .markdown-content li {
      margin: 8px 0;
    }

    .markdown-content code {
      background: #f5f5f5;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }

    .markdown-content strong {
      font-weight: 600;
    }
  `]
})
export class AdminInstructionsComponent {}


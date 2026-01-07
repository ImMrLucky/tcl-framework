import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { AppHeaderComponent } from '../shared/app-header.component';
import { IntegrationsService, ApiKey } from './integrations.service';
import { PlanService, PlanTier } from '../plan.service';

@Component({
  selector: 'app-api-keys',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatDialogModule,
    MatSnackBarModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    AppHeaderComponent
  ],
  templateUrl: './api-keys.component.html',
  styleUrls: ['./api-keys.component.scss']
})
export class ApiKeysComponent implements OnInit {
  apiKeys: ApiKey[] = [];
  loading = false;
  planTier: PlanTier | null = null;
  displayedColumns: string[] = ['name', 'prefix', 'mode', 'createdAt', 'lastUsedAt', 'actions'];
  
  newKeyName = '';
  newKeyMode: 'SANDBOX' | 'PROD' = 'SANDBOX';
  showCreateForm = false;
  createdKey: ApiKey | null = null; // Store newly created key to show it once

  constructor(
    private integrationsService: IntegrationsService,
    private planService: PlanService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    // Subscribe to plan tier
    this.planService.planContext$.subscribe(context => {
      this.planTier = context?.tier ?? null;
    });

    this.loadApiKeys();
  }

  loadApiKeys() {
    this.loading = true;
    this.integrationsService.getApiKeys().subscribe({
      next: (response) => {
        this.apiKeys = response.keys;
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to load API keys:', error);
        this.loading = false;
        const snackBarRef = this.snackBar.open('Failed to load API keys', 'Close', { duration: 5000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    });
  }

  canCreateProdKey(): boolean {
    return this.planService.hasCapability('API_ACCESS_PROD');
  }

  canCreateSandboxKey(): boolean {
    return this.planService.hasCapability('API_ACCESS_SANDBOX');
  }

  onCreateKey() {
    if (!this.newKeyName.trim()) {
      const snackBarRef = this.snackBar.open('Please enter a key name', 'Close', { duration: 3000 });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      return;
    }

    // Check capability
    const requiredCapability = this.newKeyMode === 'PROD' ? 'API_ACCESS_PROD' : 'API_ACCESS_SANDBOX';
    if (!this.planService.hasCapability(requiredCapability)) {
      const snackBarRef = this.snackBar.open(
        `Creating ${this.newKeyMode} keys requires ${requiredCapability}. Please upgrade your plan.`,
        'View Plans',
        { duration: 5000 }
      );
      snackBarRef.onAction().subscribe(() => {
        snackBarRef.dismiss();
        window.location.href = '/account?upgrade=1';
      });
      return;
    }

    this.loading = true;
    this.integrationsService.createApiKey(this.newKeyName.trim(), this.newKeyMode).subscribe({
      next: (key) => {
        this.createdKey = key; // Store the key with the raw secret
        this.apiKeys.unshift(key);
        this.newKeyName = '';
        this.showCreateForm = false;
        this.loading = false;
        
        const snackBarRef = this.snackBar.open('API key created successfully', 'Close', { duration: 5000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      },
      error: (error) => {
        console.error('Failed to create API key:', error);
        this.loading = false;
        const errorMessage = error.error?.message || 'Failed to create API key';
        const snackBarRef = this.snackBar.open(errorMessage, 'Close', { duration: 5000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    });
  }

  onRevokeKey(key: ApiKey) {
    if (!confirm(`Are you sure you want to revoke the API key "${key.name}"? This action cannot be undone.`)) {
      return;
    }

    this.loading = true;
    this.integrationsService.revokeApiKey(key.id).subscribe({
      next: () => {
        this.apiKeys = this.apiKeys.filter(k => k.id !== key.id);
        this.loading = false;
        const snackBarRef = this.snackBar.open('API key revoked successfully', 'Close', { duration: 3000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      },
      error: (error) => {
        console.error('Failed to revoke API key:', error);
        this.loading = false;
        const snackBarRef = this.snackBar.open('Failed to revoke API key', 'Close', { duration: 5000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    });
  }

  copyKey(key: ApiKey) {
    if (key.key) {
      navigator.clipboard.writeText(key.key).then(() => {
        const snackBarRef = this.snackBar.open('API key copied to clipboard', 'Close', { duration: 2000 });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      });
    }
  }

  formatDate(dateString: string): string {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  getModeColor(mode: 'SANDBOX' | 'PROD'): string {
    return mode === 'PROD' ? 'primary' : 'accent';
  }
}


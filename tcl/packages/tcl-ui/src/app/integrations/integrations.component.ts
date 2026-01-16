import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppHeaderComponent } from '../shared/app-header.component';
import { IntegrationsService, IntegrationType } from './integrations.service';
import { PlanService, PlanTier } from '../plan.service';
import { firstValueFrom } from 'rxjs';
import { EntitlementsService } from '../entitlements.service';

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
    AppHeaderComponent
  ],
  templateUrl: './integrations.component.html',
  styleUrls: ['./integrations.component.scss']
})
export class IntegrationsComponent implements OnInit {
  integrations: IntegrationType[] = [];
  loading = false;
  planTier: PlanTier | null = null;
  
  // Phase 5: Enterprise integrations
  jiraIntegration: any = null;
  webhookIntegration: any = null;
  hasIntegrationsEntitlement = false;

  constructor(
    private integrationsService: IntegrationsService,
    private planService: PlanService,
    private entitlementsService: EntitlementsService,
    private featureService: FeatureService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    // Subscribe to plan tier
    this.planService.planContext$.subscribe(context => {
      this.planTier = context?.tier ?? null;
    });

    // Check entitlements
    this.hasIntegrationsEntitlement = this.entitlementsService.hasFeature('integrations');

    this.loadIntegrations();
    if (this.hasIntegrationsEntitlement) {
      this.loadEnterpriseIntegrations();
    }
  }
  
  async loadEnterpriseIntegrations() {
    try {
      const response = await this.integrationsService.getEnterpriseIntegrations().toPromise();
      if (response?.integrations) {
        this.jiraIntegration = response.integrations.find((i: any) => i.kind === 'JIRA');
        this.webhookIntegration = response.integrations.find((i: any) => i.kind === 'WEBHOOK');
      }
    } catch (error) {
      console.error('Failed to load enterprise integrations:', error);
    }
  }
  
  configureJira() {
    // TODO: Open Jira configuration dialog
    this.snackBar.open('Jira configuration dialog coming soon', 'Close', { duration: 3000 });
  }
  
  configureWebhook() {
    // TODO: Open Webhook configuration dialog
    this.snackBar.open('Webhook configuration dialog coming soon', 'Close', { duration: 3000 });
  }

  loadIntegrations() {
    this.loading = true;
    this.integrationsService.getIntegrations().subscribe({
      next: (response) => {
        this.integrations = response.availableTypes;
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to load integrations:', error);
        this.loading = false;
      }
    });
  }

  getIntegrationCard(type: string): IntegrationType | undefined {
    return this.integrations.find(i => i.type === type);
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'CONNECTED':
        return 'primary';
      case 'ERROR':
        return 'warn';
      case 'DISCONNECTED':
      default:
        return '';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'CONNECTED':
        return 'Connected';
      case 'ERROR':
        return 'Error';
      case 'DISCONNECTED':
      default:
        return 'Not Connected';
    }
  }

  canAccessFeature(type: string): boolean {
    // Use unified FeatureService
    if (type === 'JIRA' || type === 'WEBHOOK') {
      return this.featureService.hasFeature('integrations');
    }
    if (type === 'S3' || type === 'DROPBOX' || type === 'GDRIVE') {
      if (type === 'S3') return this.featureService.hasFeature('connectorsS3');
      if (type === 'DROPBOX') return this.featureService.hasFeature('connectorsDropbox');
      if (type === 'GDRIVE') return this.featureService.hasFeature('connectorsGDrive');
    }
    
    // API and WEBHOOKS are available to all tiers (capabilities)
    if (type === 'API' || type === 'WEBHOOKS') {
      return true; // These are capabilities available to all
    }
    
    // Default: check via FeatureService
    return this.featureService.canAccessFeature(type as any);
  }

  getActionButtonText(type: string): string {
    const integration = this.getIntegrationCard(type);
    
    if (type === 'API') {
      return 'Manage API Keys';
    }
    if (type === 'WEBHOOKS') {
      return 'Manage Webhooks';
    }
    if (type === 'SHAREPOINT' && this.planTier !== 'ENTERPRISE') {
      return 'Contact Sales';
    }
    if (integration?.comingSoon) {
      return 'Coming Soon';
    }
    if (!this.canAccessFeature(type)) {
      return 'Upgrade to Enable';
    }
    if (integration?.connection?.status === 'CONNECTED') {
      return 'Manage';
    }
    return 'Connect';
  }

  getActionRoute(type: string): string {
    if (type === 'API') {
      return '/integrations/api';
    }
    if (type === 'WEBHOOKS') {
      return '/integrations/webhooks';
    }
    return '/account?upgrade=1';
  }

  isDisabled(type: string): boolean {
    const integration = this.getIntegrationCard(type);
    
    if (type === 'SHAREPOINT' && this.planTier !== 'ENTERPRISE') {
      return false; // Contact Sales is always enabled
    }
    if (integration?.comingSoon) {
      return true;
    }
    if (!this.canAccessFeature(type)) {
      return false; // Show upgrade button
    }
    return false;
  }
}


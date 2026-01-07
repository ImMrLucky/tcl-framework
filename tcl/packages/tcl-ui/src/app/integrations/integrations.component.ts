import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppHeaderComponent } from '../shared/app-header.component';
import { IntegrationsService, IntegrationType } from './integrations.service';
import { PlanService, PlanTier } from '../plan.service';

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
    AppHeaderComponent
  ],
  templateUrl: './integrations.component.html',
  styleUrls: ['./integrations.component.scss']
})
export class IntegrationsComponent implements OnInit {
  integrations: IntegrationType[] = [];
  loading = false;
  planTier: PlanTier | null = null;

  constructor(
    private integrationsService: IntegrationsService,
    private planService: PlanService
  ) {}

  ngOnInit() {
    // Subscribe to plan tier
    this.planService.planContext$.subscribe(context => {
      this.planTier = context?.tier ?? null;
    });

    this.loadIntegrations();
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
    if (this.planTier === 'SANDBOX') {
      // Sandbox can only access API and Webhooks
      return type === 'API' || type === 'WEBHOOKS';
    }
    // Team+ can access all features (except those marked comingSoon)
    return true;
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


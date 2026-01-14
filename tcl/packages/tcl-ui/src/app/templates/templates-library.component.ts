import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

interface Template {
  id: string;
  name: string;
  description?: string;
  industry?: string;
  businessFunction?: string;
  defaultLens?: string;
  guidanceMarkdown?: string;
  attachedEvidenceIds: string[];
  isSystemTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

@Component({
  selector: 'app-templates-library',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    AppHeaderComponent
  ],
  templateUrl: './templates-library.component.html',
  styleUrls: ['./templates-library.component.scss']
})
export class TemplatesLibraryComponent implements OnInit {
  templates: Template[] = [];
  loading = false;
  selectedTab = 0; // 0 = all, 1 = system, 2 = org
  
  // Filters
  industryFilter: string = '';
  businessFunctionFilter: string = '';
  nameFilter: string = '';

  displayedColumns = ['name', 'description', 'industry', 'businessFunction', 'defaultLens', 'evidenceCount', 'createdAt'];

  private get apiBase(): string {
    return this.authService.getApiBaseUrl();
  }

  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {}

  async ngOnInit() {
    await this.loadTemplates();
  }

  async loadTemplates() {
    this.loading = true;
    try {
      const params: any = {};
      if (this.industryFilter) params.industry = this.industryFilter;
      if (this.businessFunctionFilter) params.businessFunction = this.businessFunctionFilter;

      const response = await firstValueFrom(
        this.http.get<{ templates: Template[] }>(`${this.apiBase}/templates`, { params })
      );
      
      this.templates = response.templates || [];
    } catch (error: any) {
      console.error('Failed to load templates:', error);
    } finally {
      this.loading = false;
    }
  }

  getFilteredTemplates(): Template[] {
    let filtered = this.templates;

    // Filter by tab
    if (this.selectedTab === 1) {
      filtered = filtered.filter(t => t.isSystemTemplate);
    } else if (this.selectedTab === 2) {
      filtered = filtered.filter(t => !t.isSystemTemplate);
    }

    // Filter by name
    if (this.nameFilter) {
      const searchLower = this.nameFilter.toLowerCase();
      filtered = filtered.filter(t => 
        t.name.toLowerCase().includes(searchLower) ||
        (t.description && t.description.toLowerCase().includes(searchLower))
      );
    }

    return filtered;
  }

  getIndustryLabel(industry?: string): string {
    if (!industry) return '—';
    const labels: Record<string, string> = {
      'FINANCE': 'Finance',
      'TELECOM': 'Telecom',
      'HEALTHCARE': 'Healthcare',
      'INSURANCE': 'Insurance',
      'SAAS': 'SaaS',
      'RETAIL': 'Retail',
      'GOV': 'Government',
      'OTHER': 'Other',
      'UNKNOWN': 'Unknown'
    };
    return labels[industry] || industry;
  }

  getBusinessFunctionLabel(bf?: string): string {
    if (!bf) return '—';
    const labels: Record<string, string> = {
      'BILLING_SUPPORT': 'Billing Support',
      'CUSTOMER_SUPPORT_RETENTION': 'Customer Support/Retention',
      'SALES_ONBOARDING': 'Sales/Onboarding',
      'REGULATED_OPERATIONS': 'Regulated Operations',
      'MIXED': 'Mixed'
    };
    return labels[bf] || bf;
  }

  getLensLabel(lens?: string): string {
    if (!lens) return '—';
    const labels: Record<string, string> = {
      'regulatory_exposure': 'Regulatory Exposure',
      'financial_exposure': 'Financial Exposure',
      'customer_dispute_risk': 'Customer Dispute Risk',
      'promise_commitment_risk': 'Promise/Commitment Risk',
      'privacy_security_risk': 'Privacy/Security Risk',
      'operational_process_risk': 'Operational/Process Risk',
      'neutral_engine_order': 'Neutral (Engine Order)'
    };
    return labels[lens] || lens;
  }

  applyFilters() {
    // Filters are applied in getFilteredTemplates()
  }

  clearFilters() {
    this.nameFilter = '';
    this.industryFilter = '';
    this.businessFunctionFilter = '';
    this.loadTemplates();
  }
}


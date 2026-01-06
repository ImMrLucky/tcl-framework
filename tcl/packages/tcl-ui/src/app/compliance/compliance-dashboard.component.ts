import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppHeaderComponent } from '../shared/app-header.component';
import { ComplianceService, ComplianceSummary, TimeseriesPoint, TopCategory, TopType, CoveragePoint, IssuePattern } from '../compliance.service';

@Component({
  selector: 'app-compliance-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatInputModule,
    MatTableModule,
    MatChipsModule,
    MatTooltipModule,
    AppHeaderComponent
  ],
  templateUrl: './compliance-dashboard.component.html',
  styleUrls: ['./compliance-dashboard.component.scss']
})
export class ComplianceDashboardComponent implements OnInit {
  loading = false;
  
  // Date range (default: last 14 days)
  dateFrom: Date = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  dateTo: Date = new Date();
  
  // Data
  summary: ComplianceSummary | null = null;
  timeseries: TimeseriesPoint[] = [];
  topCategories: TopCategory[] = [];
  topTypes: TopType[] = [];
  coverage: CoveragePoint[] = [];
  patterns: IssuePattern[] = [];
  
  // Display columns
  displayedColumns = ['type', 'category', 'summary', 'count', 'avgScore', 'severity'];
  
  constructor(private complianceService: ComplianceService) {}
  
  ngOnInit() {
    this.loadData();
  }
  
  async loadData() {
    this.loading = true;
    try {
      const from = this.dateFrom.toISOString().split('T')[0];
      const to = this.dateTo.toISOString().split('T')[0];
      
      // Load all data in parallel
      const [summary, timeseries, topCategories, topTypes, coverage, patterns] = await Promise.all([
        this.complianceService.getSummary(from, to).toPromise(),
        this.complianceService.getTimeseries(from, to).toPromise(),
        this.complianceService.getTopCategories(from, to).toPromise(),
        this.complianceService.getTopTypes(from, to).toPromise(),
        this.complianceService.getVerificationCoverage(from, to).toPromise(),
        this.complianceService.getPatterns(from, to).toPromise(),
      ]);
      
      this.summary = summary || null;
      this.timeseries = timeseries?.timeseries || [];
      this.topCategories = topCategories?.topCategories || [];
      this.topTypes = topTypes?.topTypes || [];
      this.coverage = coverage?.coverage || [];
      this.patterns = patterns?.patterns || [];
    } catch (error: any) {
      console.error('Failed to load compliance data:', error);
    } finally {
      this.loading = false;
    }
  }
  
  onDateRangeChange() {
    this.loadData();
  }
  
  formatDate(date: Date): string {
    return date.toLocaleDateString();
  }

  getMaxValue(values: number[]): number {
    if (!values || values.length === 0) return 1;
    return Math.max(...values);
  }

  getMaxCategoryValue(): number {
    if (!this.topCategories || this.topCategories.length === 0) return 1;
    return Math.max(...this.topCategories.map(c => c.count));
  }

  getMaxTypeValue(): number {
    if (!this.topTypes || this.topTypes.length === 0) return 1;
    return Math.max(...this.topTypes.map(t => t.count));
  }
  
  getSeverityBreakdown(pattern: IssuePattern): string {
    const parts: string[] = [];
    if (pattern.severityBreakdown.critical > 0) parts.push(`${pattern.severityBreakdown.critical} critical`);
    if (pattern.severityBreakdown.high > 0) parts.push(`${pattern.severityBreakdown.high} high`);
    if (pattern.severityBreakdown.medium > 0) parts.push(`${pattern.severityBreakdown.medium} medium`);
    if (pattern.severityBreakdown.low > 0) parts.push(`${pattern.severityBreakdown.low} low`);
    return parts.join(', ') || 'N/A';
  }
  
  getMaxValue(data: number[]): number {
    return Math.max(...data, 1);
  }
  
  getBarWidth(value: number, max: number): string {
    return `${(value / max) * 100}%`;
  }
  
  getStackedBarWidth(value: number, total: number, max: number): string {
    return `${(value / max) * 100}%`;
  }
  
  getStackedBarLeft(low: number, medium: number, high: number, critical: number, index: number, max: number): string {
    let left = 0;
    if (index === 0) left = 0;
    else if (index === 1) left = (low / max) * 100;
    else if (index === 2) left = ((low + medium) / max) * 100;
    else if (index === 3) left = ((low + medium + high) / max) * 100;
    return `${left}%`;
  }
  
  getCoverageBarLeft(external: number, transcript: number, none: number, index: number, max: number): string {
    let left = 0;
    if (index === 0) left = 0;
    else if (index === 1) left = (external / max) * 100;
    else if (index === 2) left = ((external + transcript) / max) * 100;
    return `${left}%`;
  }
}


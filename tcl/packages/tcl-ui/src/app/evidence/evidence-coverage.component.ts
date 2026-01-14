import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AppHeaderComponent } from '../shared/app-header.component';
import { EvidenceService } from '../evidence.service';

// Types for evidence coverage (not yet implemented in service)
interface EvidenceCoverage {
  totalClaims: number;
  docSupported: number;
  systemVerified: number;
  transcriptOnly: number;
  verifiedPercent?: number;
  externalVerified?: number;
  totalIssues?: number;
  transcriptOnlyPercent?: number;
  unverifiedPercent?: number;
  none?: number;
  byCategory?: Record<string, {
    total: number;
    externalVerified: number;
    transcriptOnly: number;
    none: number;
  }>;
}

interface EvidenceGap {
  category: string;
  missingEvidence: string[];
  priority?: string;
  evidence?: string;
  count?: number;
  categories?: string[];
  types?: string[];
  examples?: string[];
}

@Component({
  selector: 'app-evidence-coverage',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatSnackBarModule,
    AppHeaderComponent
  ],
  templateUrl: './evidence-coverage.component.html',
  styleUrls: ['./evidence-coverage.component.scss']
})
export class EvidenceCoverageComponent implements OnInit {
  loading = false;
  coverage: EvidenceCoverage | null = null;
  gaps: EvidenceGap[] = [];

  // Date range
  dateFrom: Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
  dateTo: Date = new Date();

  constructor(
    private evidenceService: EvidenceService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.loading = true;
    try {
      // Set end date to end of day (23:59:59) to include all records from that day
      const endOfDay = new Date(this.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      const filters = {
        from: this.dateFrom.toISOString().split('T')[0],
        to: endOfDay.toISOString(),
      };

      // TODO: Implement getCoverage and getGaps in EvidenceService
      // For now, return empty data with all required properties
      const emptyCoverage: EvidenceCoverage = {
        totalClaims: 0,
        docSupported: 0,
        systemVerified: 0,
        transcriptOnly: 0,
        verifiedPercent: 0,
        externalVerified: 0,
        totalIssues: 0,
        transcriptOnlyPercent: 0,
        unverifiedPercent: 0,
        none: 0,
        byCategory: {},
      };
      
      const [coverage, gapsResponse] = await Promise.all([
        Promise.resolve(emptyCoverage),
        Promise.resolve({ gaps: [] as EvidenceGap[] }),
      ]);

      if (coverage) {
        this.coverage = coverage;
      }
      if (gapsResponse) {
        this.gaps = gapsResponse.gaps || [];
      }
    } catch (error: any) {
      console.error('Failed to load evidence data:', error);
      const snackBarRef = this.snackBar.open('Failed to load evidence data: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
  }

  applyFilters() {
    this.loadData();
  }

  getPriorityClass(priority: string | undefined): string {
    return `priority-${priority || 'unknown'}`;
  }
  
  getCategoryData(category: string): { total: number; externalVerified: number; transcriptOnly: number; none: number } | null {
    if (!this.coverage || !this.coverage.byCategory || !this.coverage.byCategory[category]) {
      return null;
    }
    return this.coverage.byCategory[category];
  }
  
  getCategoryTotal(category: string): number {
    const data = this.getCategoryData(category);
    return data?.total || 0;
  }
  
  getCategoryExternalVerified(category: string): number {
    const data = this.getCategoryData(category);
    return data?.externalVerified || 0;
  }
  
  getCategoryTranscriptOnly(category: string): number {
    const data = this.getCategoryData(category);
    return data?.transcriptOnly || 0;
  }
  
  getCategoryNone(category: string): number {
    const data = this.getCategoryData(category);
    return data?.none || 0;
  }
  
  getGapPriority(gap: EvidenceGap): string {
    return gap.priority || 'unknown';
  }
  
  getGapExamples(gap: EvidenceGap): string[] {
    return gap.examples || [];
  }
  
  getGapCategories(gap: EvidenceGap): string[] {
    return gap.categories || [];
  }
  
  getGapTypes(gap: EvidenceGap): string[] {
    return gap.types || [];
  }
  
  getGapCount(gap: EvidenceGap): number {
    return gap.count || 0;
  }

  getCategoryPercent(category: string): number {
    if (!this.coverage || !this.coverage.byCategory || !this.coverage.byCategory[category]) {
      return 0;
    }
    const cat = this.coverage.byCategory[category];
    const total = cat.total || 1;
    return Math.round((cat.externalVerified / total) * 100);
  }

  // Expose Object for template
  Object = Object;

  getCategoryKeys(): string[] {
    if (!this.coverage || !this.coverage.byCategory) {
      return [];
    }
    return Object.keys(this.coverage.byCategory);
  }
}


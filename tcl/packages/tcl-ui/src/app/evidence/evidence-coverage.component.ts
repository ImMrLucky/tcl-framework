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
import { EvidenceService, EvidenceCoverage, EvidenceGap } from '../evidence.service';

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
      const filters = {
        from: this.dateFrom.toISOString().split('T')[0],
        to: this.dateTo.toISOString().split('T')[0],
      };

      const [coverage, gapsResponse] = await Promise.all([
        this.evidenceService.getCoverage(filters).toPromise(),
        this.evidenceService.getGaps(filters).toPromise(),
      ]);

      if (coverage) {
        this.coverage = coverage;
      }
      if (gapsResponse) {
        this.gaps = gapsResponse.gaps;
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

  getPriorityClass(priority: string): string {
    return `priority-${priority}`;
  }

  getCategoryPercent(category: string): number {
    if (!this.coverage || !this.coverage.byCategory[category]) {
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


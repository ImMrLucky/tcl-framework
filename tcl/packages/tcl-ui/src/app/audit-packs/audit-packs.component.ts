import { Component, OnInit, OnDestroy } from '@angular/core';
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
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AuditPacksService, AuditPackRequest, AuditPackResponse } from '../audit-packs.service';
import { AuditService } from '../audit.service';

@Component({
  selector: 'app-audit-packs',
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
    MatSelectModule,
    MatRadioModule,
    MatCheckboxModule,
    MatSnackBarModule,
    MatProgressBarModule,
    MatChipsModule,
    AppHeaderComponent
  ],
  templateUrl: './audit-packs.component.html',
  styleUrls: ['./audit-packs.component.scss']
})
export class AuditPacksComponent implements OnInit, OnDestroy {
  loading = false;
  generating = false;
  checkingStatus = false;
  
  // Options
  exportType: 'evaluation' | 'dateRange' = 'dateRange';
  evaluationId: string = '';
  dateFrom: Date = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  dateTo: Date = new Date();
  includeAllIssues: boolean = true;
  
  // Status
  currentPackId: string | null = null;
  packStatus: AuditPackResponse | null = null;
  statusCheckInterval: any = null;
  
  // Available evaluations
  evaluations: Array<{ id: string; created_at: string; conversation_id: string }> = [];
  loadingEvaluations = false;

  constructor(
    private auditPacksService: AuditPacksService,
    private auditService: AuditService,
    private snackBar: MatSnackBar
  ) {}

  async ngOnInit() {
    await this.loadEvaluations();
  }

  async loadEvaluations() {
    this.loadingEvaluations = true;
    try {
      const response = await this.auditService.getEvaluations(100, 0).toPromise();
      if (response?.evaluations) {
        this.evaluations = response.evaluations.map((e: any) => ({
          id: e.id,
          created_at: e.created_at,
          conversation_id: e.conversation_id,
        }));
      }
    } catch (error) {
      console.error('Failed to load evaluations:', error);
    } finally {
      this.loadingEvaluations = false;
    }
  }

  async generatePack() {
    if (this.exportType === 'evaluation' && !this.evaluationId) {
      this.snackBar.open('Please select an evaluation', 'Close', { duration: 3000 });
      return;
    }

    if (this.exportType === 'dateRange' && (!this.dateFrom || !this.dateTo)) {
      this.snackBar.open('Please select a date range', 'Close', { duration: 3000 });
      return;
    }

    this.generating = true;
    this.packStatus = null;
    this.currentPackId = null;

    try {
      const request: AuditPackRequest = {
        includeAllIssues: this.includeAllIssues,
      };

      if (this.exportType === 'evaluation') {
        request.evaluationId = this.evaluationId;
      } else {
        request.dateFrom = this.dateFrom.toISOString().split('T')[0];
        request.dateTo = this.dateTo.toISOString().split('T')[0];
      }

      const response = await this.auditPacksService.generatePack(request).toPromise();
      
      if (response) {
        this.currentPackId = response.packId;
        this.packStatus = response;
        
        if (response.status === 'processing') {
          this.startStatusPolling();
        } else if (response.status === 'completed') {
          this.snackBar.open('Audit pack generated successfully!', 'Close', { duration: 3000 });
        }
      }
    } catch (error: any) {
      console.error('Failed to generate pack:', error);
      this.snackBar.open('Failed to generate pack: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.generating = false;
    }
  }

  startStatusPolling() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(async () => {
      if (!this.currentPackId) return;

      this.checkingStatus = true;
      try {
        const status = await this.auditPacksService.getPackStatus(this.currentPackId).toPromise();
        if (status) {
          this.packStatus = status;

          if (status.status === 'completed') {
            this.stopStatusPolling();
            this.snackBar.open('Audit pack generated successfully!', 'Close', { duration: 3000 });
          } else if (status.status === 'failed') {
            this.stopStatusPolling();
            this.snackBar.open('Pack generation failed: ' + (status.error || 'Unknown error'), 'Close', {
              duration: 5000
            });
          }
        }
      } catch (error) {
        console.error('Failed to check status:', error);
      } finally {
        this.checkingStatus = false;
      }
    }, 2000); // Check every 2 seconds
  }

  stopStatusPolling() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }
  }

  downloadFile(url: string, filename: string) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  downloadPDF() {
    if (this.packStatus?.files?.pdf) {
      this.downloadFile(this.packStatus.files.pdf, `audit-pack-${this.currentPackId}.pdf`);
    }
  }

  downloadJSON() {
    if (this.packStatus?.files?.json) {
      this.downloadFile(this.packStatus.files.json, `audit-pack-${this.currentPackId}.json`);
    }
  }

  downloadCSV() {
    if (this.packStatus?.files?.csv) {
      this.downloadFile(this.packStatus.files.csv, `audit-pack-${this.currentPackId}.csv`);
    }
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString();
  }

  ngOnDestroy() {
    this.stopStatusPolling();
  }
}


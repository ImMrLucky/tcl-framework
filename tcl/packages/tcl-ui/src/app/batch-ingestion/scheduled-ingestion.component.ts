/**
 * Scheduled Ingestion Management Component
 * 
 * Allows users to create and manage data sources and schedules
 */

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { AppHeaderComponent } from '../shared/app-header.component';
import { EntitlementsService } from '../entitlements.service';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { CreateSourceDialogComponent, SourceDialogData } from './create-source-dialog.component';
import { CreateScheduleDialogComponent, ScheduleDialogData } from './create-schedule-dialog.component';

interface IngestSource {
  id: string;
  org_id: string;
  type: 'S3' | 'GCS' | 'AZURE_BLOB' | 'SFTP' | 'MANIFEST_URL' | 'GDRIVE' | 'DROPBOX';
  name?: string;
  description?: string;
  config_json: any;
  enabled: boolean;
  created_at: string;
}

interface IngestSchedule {
  id: string;
  org_id: string;
  source_id: string;
  name: string;
  rrule: string;
  template_id?: string;
  mode: 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT';
  enabled: boolean;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
  ingest_sources?: IngestSource;
}

interface ScheduleRun {
  id: string;
  schedule_id: string;
  status: 'RUNNING' | 'COMPLETE' | 'FAILED' | 'CANCELED';
  started_at: string;
  ended_at?: string;
  stats_json: any;
  import_id?: string;
}

@Component({
  selector: 'app-scheduled-ingestion',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatSnackBarModule,
    MatDialogModule,
    MatExpansionModule,
    AppHeaderComponent,
    DatePipe,
  ],
  templateUrl: './scheduled-ingestion.component.html',
  styleUrls: ['./scheduled-ingestion.component.scss']
})
export class ScheduledIngestionComponent implements OnInit, OnDestroy {
  activeTab = 0;
  hasBatchIngestion = false;
  
  // Sources
  sources: IngestSource[] = [];
  loadingSources = false;
  sourceDisplayedColumns = ['name', 'type', 'enabled', 'created_at', 'actions'];
  
  // Schedules
  schedules: IngestSchedule[] = [];
  loadingSchedules = false;
  scheduleDisplayedColumns = ['name', 'source', 'rrule', 'next_run', 'status', 'actions'];
  
  // Selected schedule runs
  selectedScheduleId: string | null = null;
  scheduleRuns: ScheduleRun[] = [];
  loadingRuns = false;
  runsDisplayedColumns = ['started_at', 'status', 'stats', 'actions'];
  
  // Templates and representatives for schedule creation
  templates: Array<{ id: string; name: string }> = [];
  representatives: Array<{ id: string; display_name: string }> = [];
  
  private destroy$ = new Subject<void>();
  private get apiUrl(): string {
    return (window as any).__TCL_API_URL || 'https://protectqa.com';
  }

  constructor(
    private http: HttpClient,
    private entitlementsService: EntitlementsService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit() {
    this.hasBatchIngestion = this.entitlementsService.hasFeature('batchIngestion');
    
    if (!this.hasBatchIngestion) {
      this.snackBar.open('Scheduled ingestion is not available for your plan', 'Close', { duration: 5000 });
      this.router.navigate(['/bulk-ingest']);
      return;
    }
    
    this.loadSources();
    this.loadSchedules();
    this.loadTemplates();
    this.loadRepresentatives();
  }
  
  async loadTemplates() {
    try {
      const orgId = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;
      if (!orgId) return;
      
      const response = await firstValueFrom(
        this.http.get<{ templates: Array<{ id: string; name: string }> }>(`${this.apiUrl}/api/templates`)
      );
      this.templates = response.templates || [];
    } catch (error: any) {
      console.error('Failed to load templates:', error);
      // Don't show error - templates are optional
    }
  }
  
  async loadRepresentatives() {
    try {
      const orgId = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;
      if (!orgId) return;
      
      const response = await firstValueFrom(
        this.http.get<{ representatives: Array<{ id: string; display_name: string }> }>(
          `${this.apiUrl}/api/orgs/${orgId}/representatives`
        )
      );
      this.representatives = response.representatives || [];
    } catch (error: any) {
      console.error('Failed to load representatives:', error);
      // Don't show error - representatives are optional
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadSources() {
    this.loadingSources = true;
    try {
      const response = await firstValueFrom(
        this.http.get<{ sources: IngestSource[] }>(`${this.apiUrl}/api/ingest/sources`)
      );
      this.sources = response.sources || [];
    } catch (error: any) {
      this.snackBar.open('Failed to load sources: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loadingSources = false;
    }
  }

  async loadSchedules() {
    this.loadingSchedules = true;
    try {
      const response = await firstValueFrom(
        this.http.get<{ schedules: IngestSchedule[] }>(`${this.apiUrl}/api/ingest/schedules`)
      );
      this.schedules = response.schedules || [];
    } catch (error: any) {
      this.snackBar.open('Failed to load schedules: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loadingSchedules = false;
    }
  }

  async loadScheduleRuns(scheduleId: string) {
    this.selectedScheduleId = scheduleId;
    this.loadingRuns = true;
    try {
      const response = await firstValueFrom(
        this.http.get<{ runs: ScheduleRun[] }>(`${this.apiUrl}/api/ingest/schedules/${scheduleId}/runs`)
      );
      this.scheduleRuns = response.runs || [];
    } catch (error: any) {
      this.snackBar.open('Failed to load runs: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loadingRuns = false;
    }
  }

  async toggleSchedule(schedule: IngestSchedule) {
    try {
      const response = await firstValueFrom(
        this.http.patch<{ schedule: IngestSchedule }>(
          `${this.apiUrl}/api/ingest/schedules/${schedule.id}`,
          { enabled: !schedule.enabled }
        )
      );
      await this.loadSchedules();
      this.snackBar.open(
        `Schedule ${response.schedule.enabled ? 'enabled' : 'disabled'}`,
        'Close',
        { duration: 3000 }
      );
    } catch (error: any) {
      this.snackBar.open('Failed to update schedule: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  navigateToImport(importId: string) {
    this.router.navigate(['/bulk-ingest/import', importId]);
  }

  getStatusColor(status: string): 'primary' | 'accent' | 'warn' {
    switch (status) {
      case 'COMPLETE':
        return 'primary';
      case 'RUNNING':
        return 'accent';
      case 'FAILED':
        return 'warn';
      default:
        return 'accent';
    }
  }

  formatRRule(rrule: string): string {
    if (rrule.includes('FREQ=HOURLY')) return 'Hourly';
    if (rrule.includes('FREQ=DAILY')) return 'Daily';
    if (rrule.includes('FREQ=WEEKLY')) return 'Weekly';
    return rrule;
  }

  async createSource() {
    const dialogRef = this.dialog.open(CreateSourceDialogComponent, {
      width: '600px',
      data: {} as SourceDialogData
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result) {
      try {
        await firstValueFrom(
          this.http.post<{ source: IngestSource }>(`${this.apiUrl}/api/ingest/sources`, result)
        );
        this.snackBar.open('Data source created successfully', 'Close', { duration: 3000 });
        await this.loadSources();
      } catch (error: any) {
        this.snackBar.open('Failed to create source: ' + (error.error?.error || error.message), 'Close', {
          duration: 5000
        });
      }
    }
  }

  async testSource(source: IngestSource) {
    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; message: string }>(
          `${this.apiUrl}/api/ingest/sources/${source.id}/test`,
          {}
        )
      );
      this.snackBar.open(
        response.message || (response.success ? 'Connection test successful' : 'Connection test failed'),
        'Close',
        { duration: 3000 }
      );
    } catch (error: any) {
      this.snackBar.open('Connection test failed: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  async editSource(source: IngestSource) {
    const dialogRef = this.dialog.open(CreateSourceDialogComponent, {
      width: '600px',
      data: { source } as SourceDialogData
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result) {
      try {
        await firstValueFrom(
          this.http.patch<{ source: IngestSource }>(
            `${this.apiUrl}/api/ingest/sources/${source.id}`,
            result
          )
        );
        this.snackBar.open('Data source updated successfully', 'Close', { duration: 3000 });
        await this.loadSources();
      } catch (error: any) {
        this.snackBar.open('Failed to update source: ' + (error.error?.error || error.message), 'Close', {
          duration: 5000
        });
      }
    }
  }

  async createSchedule() {
    if (this.sources.length === 0) {
      this.snackBar.open('Please create a data source first', 'Close', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(CreateScheduleDialogComponent, {
      width: '600px',
      data: {
        sources: this.sources,
        templates: this.templates,
        representatives: this.representatives,
      } as ScheduleDialogData
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result) {
      try {
        await firstValueFrom(
          this.http.post<{ schedule: IngestSchedule }>(`${this.apiUrl}/api/ingest/schedules`, result)
        );
        this.snackBar.open('Schedule created successfully', 'Close', { duration: 3000 });
        await this.loadSchedules();
      } catch (error: any) {
        this.snackBar.open('Failed to create schedule: ' + (error.error?.error || error.message), 'Close', {
          duration: 5000
        });
      }
    }
  }

  viewScheduleRuns(schedule: IngestSchedule) {
    this.loadScheduleRuns(schedule.id);
    this.activeTab = 2; // Switch to runs tab
  }

  async editSchedule(schedule: IngestSchedule) {
    const dialogRef = this.dialog.open(CreateScheduleDialogComponent, {
      width: '600px',
      data: {
        schedule,
        sources: this.sources,
        templates: this.templates,
        representatives: this.representatives,
      } as ScheduleDialogData
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (result) {
      try {
        await firstValueFrom(
          this.http.patch<{ schedule: IngestSchedule }>(
            `${this.apiUrl}/api/ingest/schedules/${schedule.id}`,
            result
          )
        );
        this.snackBar.open('Schedule updated successfully', 'Close', { duration: 3000 });
        await this.loadSchedules();
      } catch (error: any) {
        this.snackBar.open('Failed to update schedule: ' + (error.error?.error || error.message), 'Close', {
          duration: 5000
        });
      }
    }
  }
}


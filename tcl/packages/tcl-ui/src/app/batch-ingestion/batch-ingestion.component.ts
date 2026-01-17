import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { AppHeaderComponent } from '../shared/app-header.component';
import { AddRepresentativeDialogComponent } from '../shared/add-representative-dialog.component';
import { BatchIngestionService, Batch, BatchItem } from './batch-ingestion.service';
import { EntitlementsService } from '../entitlements.service';
import { MemberService } from '../member.service';
import { AuthService } from '../auth.service';
import { interval, Subscription } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-batch-ingestion',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatTableModule,
    MatCheckboxModule,
    MatChipsModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDialogModule,
    AppHeaderComponent,
  ],
  templateUrl: './batch-ingestion.component.html',
  styleUrls: ['./batch-ingestion.component.scss']
})
export class BatchIngestionComponent implements OnInit, OnDestroy {
  activeTab = 0;
  hasBatchIngestion = false;
  
  // Upload tab
  selectedFiles: File[] = [];
  
  // Connector tabs
  connectors = [
    { type: 'S3', name: 'Amazon S3', icon: 'storage' },
    { type: 'DROPBOX', name: 'Dropbox', icon: 'cloud' },
    { type: 'GDRIVE', name: 'Google Drive', icon: 'folder' },
  ];
  
  activeConnector: string | null = null;
  connectorConfig: any = {};
  connectorSecrets: any = {};
  connectorObjects: any[] = [];
  selectedObjects: Set<string> = new Set();
  loadingConnector = false;
  browsingPath = '';
  
  // Batch management
  currentBatch: Batch | null = null;
  batchItems: BatchItem[] = [];
  loadingBatch = false;
  progressSubscription?: Subscription;
  
  // Representative selection
  representatives: Array<{ id: string; display_name: string }> = [];
  selectedRepresentativeId: string | null = null;
  representativesLoading = false;
  
  // Table columns
  displayedColumns = ['select', 'name', 'type', 'size', 'status'];
  connectorDisplayedColumns = ['select', 'name', 'type', 'size', 'modified'];
  
  constructor(
    private batchService: BatchIngestionService,
    private entitlementsService: EntitlementsService,
    private memberService: MemberService,
    private authService: AuthService,
    private http: HttpClient,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}
  
  ngOnInit() {
    this.hasBatchIngestion = this.entitlementsService.hasFeature('batchIngestion');
    
    if (!this.hasBatchIngestion) {
      this.snackBar.open('Batch ingestion is not available for your plan', 'Close', { duration: 5000 });
      this.router.navigate(['/ingest']);
      return;
    }
    
    this.loadRepresentatives();
    
    // Check if batch ID is in route
    this.route.params.subscribe(params => {
      if (params['batchId']) {
        this.loadBatch(params['batchId']);
      }
    });
  }
  
  ngOnDestroy() {
    if (this.progressSubscription) {
      this.progressSubscription.unsubscribe();
    }
  }
  
  // File upload handlers
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.selectedFiles = Array.from(input.files);
    }
  }
  
  removeFile(index: number) {
    this.selectedFiles.splice(index, 1);
  }
  
  async createBatchFromUpload() {
    if (this.selectedFiles.length === 0) {
      this.snackBar.open('Please select at least one file', 'Close', { duration: 3000 });
      return;
    }
    
    try {
      const items = this.selectedFiles.map(file => ({
        title: file.name,
        mode: 'AUDIO_PLUS_TRANSCRIPT' as const,
        sourceRef: {
          name: file.name,
          size: file.size,
          type: file.type,
        },
      }));
      
      const response = await this.batchService.createBatch('UPLOAD', items).toPromise();
      
      if (response?.success && response.batch) {
        this.currentBatch = response.batch;
        this.router.navigate(['/bulk-ingest', response.batch.id]);
        this.snackBar.open('Batch created successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      this.snackBar.open('Failed to create batch: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  // Connector handlers
  async connectConnector(type: string) {
    this.loadingConnector = true;
    try {
      // Test connection
      const testResult = await this.batchService.testConnector(
        type,
        this.connectorConfig[type] || {},
        this.connectorSecrets[type] || {}
      ).toPromise();
      
      if (testResult?.success) {
        this.activeConnector = type;
        this.browsingPath = '';
        await this.loadConnectorObjects(type);
        this.snackBar.open('Connected successfully', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Connection failed: ' + (testResult?.error || 'Unknown error'), 'Close', {
          duration: 5000
        });
      }
    } catch (error: any) {
      this.snackBar.open('Failed to connect: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loadingConnector = false;
    }
  }
  
  async loadConnectorObjects(type: string, path?: string) {
    if (!this.activeConnector) return;
    
    try {
      const result = await this.batchService.listConnectorObjects(type, {
        path: path || this.browsingPath,
        limit: 100,
        recursive: false,
        config: this.connectorConfig[type] || {},
        secrets: this.connectorSecrets[type] || {},
      }).toPromise();
      
      if (result) {
        this.connectorObjects = result.objects || [];
      }
    } catch (error: any) {
      this.snackBar.open('Failed to load objects: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  navigateToFolder(object: any) {
    if (object.isDirectory) {
      this.browsingPath = object.path;
      this.selectedObjects.clear();
      this.loadConnectorObjects(this.activeConnector!, object.path);
    }
  }
  
  toggleObjectSelection(object: any) {
    if (this.selectedObjects.has(object.id)) {
      this.selectedObjects.delete(object.id);
    } else {
      this.selectedObjects.add(object.id);
    }
  }
  
  selectAllObjects(checked: boolean) {
    if (checked) {
      this.selectedObjects = new Set(this.connectorObjects.map(o => o.id));
    } else {
      this.selectedObjects.clear();
    }
  }
  
  async createBatchFromSelection() {
    if (this.selectedObjects.size === 0) {
      this.snackBar.open('Please select at least one file', 'Close', { duration: 3000 });
      return;
    }
    
    if (!this.activeConnector) return;
    
    try {
      const selection = this.connectorObjects.filter(obj => this.selectedObjects.has(obj.id));
      
      const config: any = {};
      if (this.selectedRepresentativeId) {
        config.representativeId = this.selectedRepresentativeId;
      }
      
      const response = await this.batchService.createBatchFromSelection(
        this.activeConnector,
        selection,
        config
      ).toPromise();
      
      if (response?.success && response.batch) {
        this.currentBatch = response.batch;
        this.router.navigate(['/bulk-ingest', response.batch.id]);
        this.snackBar.open('Batch created successfully', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      this.snackBar.open('Failed to create batch: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  // Batch management
  async loadBatch(batchId: string) {
    this.loadingBatch = true;
    try {
      const response = await this.batchService.getBatch(batchId).toPromise();
      if (response) {
        this.currentBatch = response.batch;
        this.batchItems = response.items || [];
        
        // Start polling if batch is in progress
        if (this.isBatchInProgress(response.batch)) {
          this.startProgressPolling(batchId);
        }
      }
    } catch (error: any) {
      this.snackBar.open('Failed to load batch: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loadingBatch = false;
    }
  }
  
  async startBatch() {
    if (!this.currentBatch) return;
    
    try {
      const response = await this.batchService.startBatch(this.currentBatch.id).toPromise();
      if (response?.success) {
        this.currentBatch = response.batch;
        this.startProgressPolling(this.currentBatch.id);
        this.snackBar.open('Batch started', 'Close', { duration: 3000 });
      }
    } catch (error: any) {
      this.snackBar.open('Failed to start batch: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  async cancelBatch() {
    if (!this.currentBatch) return;
    
    try {
      await this.batchService.cancelBatch(this.currentBatch.id).toPromise();
      this.snackBar.open('Batch canceled', 'Close', { duration: 3000 });
      await this.loadBatch(this.currentBatch.id);
    } catch (error: any) {
      this.snackBar.open('Failed to cancel batch: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }
  
  // Progress tracking
  isBatchInProgress(batch: Batch): boolean {
    return ['QUEUED', 'RUNNING'].includes(batch.status);
  }
  
  startProgressPolling(batchId: string) {
    if (this.progressSubscription) {
      this.progressSubscription.unsubscribe();
    }
    
    this.progressSubscription = interval(2000) // Poll every 2 seconds
      .pipe(
        switchMap(() => this.batchService.getBatch(batchId)),
        takeWhile(() => this.currentBatch ? this.isBatchInProgress(this.currentBatch) : false, true)
      )
      .subscribe({
        next: (response) => {
          if (response) {
            this.currentBatch = response.batch;
            this.batchItems = response.items || [];
            
            // Stop polling if batch is complete
            if (!this.isBatchInProgress(response.batch)) {
              this.progressSubscription?.unsubscribe();
            }
          }
        },
        error: (error) => {
          console.error('Progress polling error:', error);
        }
      });
  }
  
  getProgressPercentage(batch: Batch | null): number {
    if (!batch || !batch.progress_json) return 0;
    const progress = batch.progress_json;
    if (progress.total === 0) return 0;
    return Math.round(((progress.complete + progress.failed) / progress.total) * 100);
  }
  
  getStatusColor(status: string): string {
    switch (status) {
      case 'COMPLETE':
        return 'primary';
      case 'FAILED':
        return 'warn';
      case 'PROCESSING':
      case 'RUNNING':
        return 'accent';
      default:
        return '';
    }
  }
  
  formatFileSize(bytes?: number): string {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async loadRepresentatives() {
    this.representativesLoading = true;
    try {
      const user = this.authService.getCurrentUser();
      if (!user?.id) {
        return;
      }
      
      // Get orgId from user's organizations
      const orgsResponse = await firstValueFrom(this.memberService.getUserOrgs(user.id));
      const orgs = orgsResponse?.orgs || [];
      if (orgs.length === 0) {
        return;
      }
      
      const orgId = orgs[0].id;
      const apiBase = this.authService.getApiBaseUrl();
      const data = await firstValueFrom(
        this.http.get<{ representatives: Array<{ id: string; display_name: string }> }>(
          `${apiBase}/orgs/${orgId}/representatives`
        )
      );
      this.representatives = data.representatives || [];
    } catch (error) {
      console.error('Failed to load representatives:', error);
    } finally {
      this.representativesLoading = false;
    }
  }

  async upsertRepresentative(displayName: string): Promise<string | null> {
    try {
      const user = this.authService.getCurrentUser();
      if (!user?.id) {
        return null;
      }
      
      // Get orgId from user's organizations
      const orgsResponse = await firstValueFrom(this.memberService.getUserOrgs(user.id));
      const orgs = orgsResponse?.orgs || [];
      if (orgs.length === 0) {
        return null;
      }
      
      const orgId = orgs[0].id;
      const apiBase = this.authService.getApiBaseUrl();
      const data = await firstValueFrom(
        this.http.post<{ representative: { id: string } }>(
          `${apiBase}/orgs/${orgId}/representatives/upsert-by-name`,
          { displayName }
        )
      );
      // Reload representatives to include the new one
      await this.loadRepresentatives();
      return data.representative?.id || null;
    } catch (error) {
      console.error('Failed to upsert representative:', error);
    }
    return null;
  }

  async openAddRepresentativeDialog() {
    const dialogRef = this.dialog.open(AddRepresentativeDialogComponent, {
      width: '400px',
      data: { displayName: '' }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result && result.displayName) {
        const id = await this.upsertRepresentative(result.displayName.trim());
        if (id) {
          this.selectedRepresentativeId = id;
        }
      }
    });
  }
}


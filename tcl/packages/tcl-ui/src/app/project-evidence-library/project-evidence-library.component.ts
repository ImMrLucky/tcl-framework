import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { HttpClient } from '@angular/common/http';
import { AppHeaderComponent } from '../shared/app-header.component';
import { EvidenceService, EvidenceItem } from '../evidence.service';
import { AuthService } from '../auth.service';
import { MemberService } from '../member.service';
import { EvidenceUploadDialogComponent } from '../evidence-library/evidence-upload-dialog.component';
import { firstValueFrom } from 'rxjs';

interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description?: string;
}

@Component({
  selector: 'app-project-evidence-library',
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
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatMenuModule,
    AppHeaderComponent
  ],
  templateUrl: './project-evidence-library.component.html',
  styleUrls: ['./project-evidence-library.component.scss']
})
export class ProjectEvidenceLibraryComponent implements OnInit {
  evidenceItems: EvidenceItem[] = [];
  loading = false;
  projectId: string | null = null;
  project: Project | null = null;
  orgId: string | null = null;
  currentUserId: string | null = null;
  userRole: string | null = null;
  
  // Filters
  titleFilter: string = '';
  statusFilter: 'DRAFT' | 'APPROVED' | 'DEPRECATED' | '' = '';
  sourceTypeFilter: EvidenceItem['sourceType'] | '' = '';

  displayedColumns = ['title', 'sourceType', 'status', 'indexStatus', 'version', 'createdAt', 'actions'];

  private get apiBase(): string {
    if (typeof window !== 'undefined') {
      const apiUrl = (window as any).__TCL_API_URL;
      if (apiUrl) {
        return `${apiUrl}/api`;
      }
    }
    return '/api';
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private evidenceService: EvidenceService,
    private authService: AuthService,
    private memberService: MemberService,
    private http: HttpClient,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  async ngOnInit() {
    // Get projectId from route
    this.projectId = this.route.snapshot.paramMap.get('projectId');
    if (!this.projectId) {
      this.router.navigate(['/dashboard']);
      return;
    }

    // Get current user
    this.authService.currentUser$.subscribe(async user => {
      this.currentUserId = user?.id || null;
      if (user?.id && this.projectId) {
        await this.loadProject();
        if (this.orgId) {
          this.loadUserRole();
          this.loadEvidenceItems();
        }
      }
    });
  }

  async loadProject() {
    if (!this.projectId) return;

    try {
      const project = await firstValueFrom(
        this.http.get<Project>(`${this.apiBase}/projects/${this.projectId}`)
      );
      this.project = project;
      this.orgId = project.orgId;
    } catch (error: any) {
      console.error('Failed to load project:', error);
      this.snackBar.open('Failed to load project: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      this.router.navigate(['/dashboard']);
    }
  }

  async loadUserRole() {
    if (!this.currentUserId || !this.orgId) return;
    try {
      const membersResponse = await firstValueFrom(
        this.memberService.listMembers(this.orgId, this.currentUserId)
      );
      if (membersResponse) {
        const currentMember = membersResponse.members.find(m => m.userId === this.currentUserId);
        this.userRole = currentMember?.role || null;
      }
    } catch (error) {
      console.error('Failed to load user role:', error);
    }
  }

  async loadEvidenceItems() {
    if (!this.orgId || !this.projectId) return;
    
    this.loading = true;
    try {
      const response = await this.evidenceService.listEvidenceItems({
        orgId: this.orgId,
        projectId: this.projectId,
        scope: 'PROJECT', // Only show project-level evidence
        status: this.statusFilter || undefined,
        sourceType: this.sourceTypeFilter || undefined,
      }).toPromise();
      
      if (response) {
        // Apply client-side filter for title
        let filtered = response.items;
        
        if (this.titleFilter) {
          const searchLower = this.titleFilter.toLowerCase();
          filtered = filtered.filter(item => 
            item.title.toLowerCase().includes(searchLower) ||
            (item.description && item.description.toLowerCase().includes(searchLower))
          );
        }
        
        this.evidenceItems = filtered;
      }
    } catch (error: any) {
      console.error('Failed to load evidence items:', error);
      this.snackBar.open('Failed to load evidence: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    } finally {
      this.loading = false;
    }
  }

  applyFilters() {
    this.loadEvidenceItems();
  }

  clearFilters() {
    this.titleFilter = '';
    this.statusFilter = '';
    this.sourceTypeFilter = '';
    this.loadEvidenceItems();
  }

  openUploadDialog() {
    if (!this.orgId || !this.projectId) {
      this.snackBar.open('Organization and Project IDs are required', 'Close', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(EvidenceUploadDialogComponent, {
      width: '700px',
      data: {
        orgId: this.orgId,
        projectId: this.projectId,
        scope: 'PROJECT' as const
      }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.loadEvidenceItems();
      }
    });
  }

  viewEvidence(item: EvidenceItem) {
    this.router.navigate(['/evidence', item.id]);
  }

  async approveEvidence(item: EvidenceItem) {
    try {
      await this.evidenceService.approveEvidenceItem(item.id).toPromise();
      this.snackBar.open('Evidence approved successfully', 'Close', { duration: 3000 });
      this.loadEvidenceItems();
    } catch (error: any) {
      console.error('Failed to approve evidence:', error);
      this.snackBar.open('Failed to approve evidence: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  async deprecateEvidence(item: EvidenceItem) {
    if (!confirm(`Are you sure you want to deprecate "${item.title}"?`)) {
      return;
    }

    try {
      await this.evidenceService.deprecateEvidenceItem(item.id).toPromise();
      this.snackBar.open('Evidence deprecated successfully', 'Close', { duration: 3000 });
      this.loadEvidenceItems();
    } catch (error: any) {
      console.error('Failed to deprecate evidence:', error);
      this.snackBar.open('Failed to deprecate evidence: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
    }
  }

  canApprove(): boolean {
    return this.userRole === 'OWNER' || this.userRole === 'ADMIN';
  }

  getStatusClass(status: string): string {
    return `status-${status.toLowerCase()}`;
  }

  getIndexStatusClass(status: string): string {
    return `index-status-${status.toLowerCase()}`;
  }

  getSourceTypeLabel(sourceType: string): string {
    const labels: Record<string, string> = {
      'POLICY': 'Policy',
      'RULESET': 'Ruleset',
      'KNOWLEDGE': 'Knowledge',
      'ACCOUNT_FACTS': 'Account Facts',
      'LEGAL': 'Legal',
      'URL_LINK': 'URL Link',
      'SYSTEM_EXPORT': 'System Export'
    };
    return labels[sourceType] || sourceType;
  }
}


import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
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
import { AppHeaderComponent } from '../shared/app-header.component';
import { EvidenceService, EvidenceItem } from '../evidence.service';
import { AuthService } from '../auth.service';
import { MemberService } from '../member.service';
import { EvidenceUploadDialogComponent } from './evidence-upload-dialog.component';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-evidence-library',
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
  templateUrl: './evidence-library.component.html',
  styleUrls: ['./evidence-library.component.scss']
})
export class EvidenceLibraryComponent implements OnInit, OnDestroy {
  evidenceItems: EvidenceItem[] = [];
  loading = false;
  orgId: string | null = null;
  currentUserId: string | null = null;
  userRole: string | null = null;
  
  // Filters
  titleFilter: string = '';
  statusFilter: 'DRAFT' | 'APPROVED' | 'DEPRECATED' | '' = '';
  sourceTypeFilter: EvidenceItem['sourceType'] | '' = '';
  authorityLevelFilter: 'BINDING' | 'INFORMATIONAL' | '' = '';
  overridePolicyFilter: 'LOCKED' | 'ALLOW_SUPPLEMENT' | 'ALLOW_OVERRIDE' | '' = '';

  displayedColumns = ['title', 'sourceType', 'authorityLevel', 'overridePolicy', 'status', 'indexStatus', 'version', 'createdAt', 'actions'];
  
  hasPoliciesToMigrate = false;
  migrationInProgress = false;
  private destroy$ = new Subject<void>();

  constructor(
    private evidenceService: EvidenceService,
    private authService: AuthService,
    private memberService: MemberService,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private http: HttpClient
  ) {}

  async ngOnInit() {
    // Get current user - use takeUntil to prevent memory leaks
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(async user => {
        this.currentUserId = user?.id || null;
        if (user?.id) {
          // Get user's orgs
          try {
            const orgsResponse = await firstValueFrom(this.memberService.getUserOrgs(user.id));
            if (orgsResponse && orgsResponse.orgs && orgsResponse.orgs.length > 0) {
              this.orgId = orgsResponse.orgs[0].id; // Use first org for now
              this.loadUserRole();
              this.loadEvidenceItems();
              this.checkPoliciesMigration();
            }
          } catch (error) {
            console.error('Failed to load user orgs:', error);
            // Don't show error to user - just log it
          }
        }
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
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
    if (!this.orgId) return;
    
    this.loading = true;
    try {
      const response = await firstValueFrom(
        this.evidenceService.listEvidenceItems({
          orgId: this.orgId,
          scope: 'ORG', // Only show org-level evidence
          status: this.statusFilter || undefined,
          sourceType: this.sourceTypeFilter || undefined,
        })
      );
      
      if (response) {
        // Apply client-side filters for title, authorityLevel, overridePolicy
        let filtered = response.items;
        
        if (this.titleFilter) {
          const searchLower = this.titleFilter.toLowerCase();
          filtered = filtered.filter(item => 
            item.title.toLowerCase().includes(searchLower) ||
            (item.description && item.description.toLowerCase().includes(searchLower))
          );
        }
        
        if (this.authorityLevelFilter) {
          filtered = filtered.filter(item => item.authorityLevel === this.authorityLevelFilter);
        }
        
        if (this.overridePolicyFilter) {
          filtered = filtered.filter(item => item.overridePolicy === this.overridePolicyFilter);
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
    this.authorityLevelFilter = '';
    this.overridePolicyFilter = '';
    this.loadEvidenceItems();
  }

  openUploadDialog() {
    if (!this.orgId) {
      this.snackBar.open('Organization ID is required', 'Close', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(EvidenceUploadDialogComponent, {
      width: '700px',
      data: {
        orgId: this.orgId,
        scope: 'ORG' as const
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
      await firstValueFrom(this.evidenceService.approveEvidenceItem(item.id));
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
      await firstValueFrom(this.evidenceService.deprecateEvidenceItem(item.id));
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

  canLock(): boolean {
    return this.userRole === 'OWNER' || this.userRole === 'ADMIN';
  }

  getStatusClass(status: string): string {
    return `status-${status.toLowerCase()}`;
  }

  getIndexStatusClass(status: string): string {
    return `index-status-${status.toLowerCase()}`;
  }

  async checkPoliciesMigration() {
    if (!this.orgId) return;
    try {
      const apiBase = this.authService.getApiBaseUrl();
      const response = await firstValueFrom(
        this.http.get<{ policies?: any[] }>(`${apiBase}/policies`)
      );
      this.hasPoliciesToMigrate = (response.policies?.length || 0) > 0;
    } catch (error: any) {
      console.error('Failed to check policies:', error);
      // If policies endpoint doesn't exist or fails, assume no migration needed
      this.hasPoliciesToMigrate = false;
      // Don't show error to user - this is a background check
    }
  }

  async migratePolicies() {
    if (!this.orgId || !confirm('This will migrate all policies to evidence items. Continue?')) {
      return;
    }

    this.migrationInProgress = true;
    try {
      const apiBase = this.authService.getApiBaseUrl();
      const result = await firstValueFrom(
        this.http.post<{ success: boolean; migratedCount?: number; error?: string }>(
          `${apiBase}/evidence/migrate-policies`,
          {}
        )
      );
      
      if (result.success) {
        this.snackBar.open(`Successfully migrated ${result.migratedCount || 0} policies to evidence items`, 'Close', { duration: 5000 });
        this.hasPoliciesToMigrate = false;
        this.loadEvidenceItems();
      } else {
        this.snackBar.open(result.error || 'Failed to migrate policies', 'Close', { duration: 5000 });
      }
    } catch (error: any) {
      console.error('Failed to migrate policies:', error);
      this.snackBar.open('Failed to migrate policies: ' + (error.error?.error || error.message || 'Unknown error'), 'Close', { duration: 5000 });
    } finally {
      this.migrationInProgress = false;
    }
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

  getAuthorityLevelLabel(level: string | undefined): string {
    if (!level) return 'N/A';
    return level === 'BINDING' ? 'Binding' : 'Informational';
  }

  getOverridePolicyLabel(policy: string | undefined): string {
    if (!policy) return 'N/A';
    const labels: Record<string, string> = {
      'LOCKED': 'Locked',
      'ALLOW_SUPPLEMENT': 'Allow Supplement',
      'ALLOW_OVERRIDE': 'Allow Override'
    };
    return labels[policy] || policy;
  }
}


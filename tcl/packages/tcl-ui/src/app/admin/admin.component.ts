import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService, Org, EmulationState } from './admin.service';
import { PlanService } from '../plan.service';
import { AuthService } from '../auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    MatCardModule,
    MatTabsModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatChipsModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatPaginatorModule,
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss']
})
export class AdminComponent implements OnInit, OnDestroy {
  orgs: Org[] = [];
  allOrgs: Org[] = [];
  selectedOrgId: string = '';
  loading = false;
  loadingOrgs = false;
  loadingAllOrgs = false;
  
  emulationEnabled = false;
  emulationTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE' = 'SANDBOX';
  
  displayedColumns = ['name', 'planTier', 'planStatus', 'isInternalTest', 'actions'];
  upgradeDisplayedColumns: string[] = ['name', 'planTier', 'planStatus', 'upgradeActions'];
  
  currentOrgId: string = '';
  
  // Pagination for org upgrades
  upgradePageSize = 50;
  upgradePageIndex = 0;
  upgradeTotalOrgs = 0;
  upgradeSearchQuery = '';
  upgradePlanTierFilter: string | undefined = undefined;
  upgradePlanStatusFilter: string | undefined = undefined;
  
  private destroy$ = new Subject<void>();

  constructor(
    private adminService: AdminService,
    private planService: PlanService,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    // Load plan context first to ensure active org is set
    this.planService.loadPlanContext();
    
    // Subscribe to plan context changes to update emulation state
    this.planService.planContext$
      .pipe(takeUntil(this.destroy$))
      .subscribe(context => {
        if (context && (context as any).emulated) {
          this.emulationEnabled = true;
          this.emulationTier = (context as any).effectivePlanTier || 'SANDBOX';
        } else {
          this.emulationEnabled = false;
        }
      });
    
    await this.loadOrgs();
    await this.loadAllOrgs();
    
    // Get current org from plan context or localStorage
    this.loadCurrentOrg();
  }
  
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadOrgs() {
    this.loadingOrgs = true;
    try {
      this.orgs = await this.adminService.getOrgs().toPromise() || [];
      // Don't auto-select first org - let loadCurrentOrg handle it
    } catch (error: any) {
      console.error('Failed to load orgs:', error);
      const snackBarRef = this.snackBar.open('Failed to load organizations: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loadingOrgs = false;
    }
  }

  async loadAllOrgs() {
    this.loadingAllOrgs = true;
    try {
      const response = await this.adminService.getAllOrgs({
        limit: this.upgradePageSize,
        offset: this.upgradePageIndex * this.upgradePageSize,
        query: this.upgradeSearchQuery || undefined,
        planTier: this.upgradePlanTierFilter,
        planStatus: this.upgradePlanStatusFilter,
      }).toPromise();
      
      if (response) {
        this.allOrgs = response.orgs || [];
        this.upgradeTotalOrgs = response.total || 0;
        console.log(`Loaded ${this.allOrgs.length} orgs (page ${this.upgradePageIndex + 1}, total: ${this.upgradeTotalOrgs})`);
      } else {
        this.allOrgs = [];
        this.upgradeTotalOrgs = 0;
      }
      
      if (this.allOrgs.length === 0 && this.upgradePageIndex === 0) {
        const snackBarRef = this.snackBar.open('No organizations found. Make sure you are a superuser.', 'Close', {
          duration: 5000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    } catch (error: any) {
      console.error('Failed to load all orgs:', error);
      const snackBarRef = this.snackBar.open('Failed to load organizations: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      this.allOrgs = [];
      this.upgradeTotalOrgs = 0;
    } finally {
      this.loadingAllOrgs = false;
    }
  }

  onUpgradePageChange(event: PageEvent) {
    this.upgradePageIndex = event.pageIndex;
    this.upgradePageSize = event.pageSize;
    this.loadAllOrgs();
  }

  onUpgradeSearch() {
    this.upgradePageIndex = 0; // Reset to first page when searching
    this.loadAllOrgs();
  }

  onUpgradeFilterChange() {
    this.upgradePageIndex = 0; // Reset to first page when filtering
    this.loadAllOrgs();
  }

  async loadCurrentOrg() {
    // First check localStorage for active org ID
    const activeOrgId = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;
    
    if (activeOrgId) {
      // Verify this org is in the user's org list
      const org = this.orgs.find(o => o.id === activeOrgId);
      if (org) {
        this.currentOrgId = activeOrgId;
        this.selectedOrgId = activeOrgId;
        return;
      }
    }
    
    // If no active org in localStorage or not found in orgs, try to get from /api/me
    try {
      const apiUrl = (window as any).__TCL_API_URL || 'https://protectqa.com';
      const token = await this.getAccessToken();
      const headers: { [key: string]: string } = {};
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      // Include active org ID header if present (for consistency with interceptor)
      const activeOrgId = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;
      if (activeOrgId) {
        headers['X-Active-Org-Id'] = activeOrgId;
      }
      
      const response = await fetch(`${apiUrl}/api/me`, {
        headers
      }).then(r => r.json());
      
      if (response?.org?.id) {
        const orgId = response.org.id;
        const org = this.orgs.find(o => o.id === orgId);
        if (org) {
          this.currentOrgId = orgId;
          this.selectedOrgId = orgId;
          // Store in localStorage for consistency
          localStorage.setItem('activeOrgId', orgId);
          return;
        }
      }
    } catch (error) {
      console.warn('Failed to get current org from /api/me:', error);
    }
    
    // Fallback to first org
    if (this.orgs.length > 0) {
      this.currentOrgId = this.orgs[0].id;
      this.selectedOrgId = this.orgs[0].id;
    }
  }
  
  private async getAccessToken(): Promise<string | null> {
    try {
      return await this.authService.getAccessToken();
    } catch (e) {
      console.warn('Failed to get access token:', e);
      return null;
    }
  }

  async switchOrg() {
    if (!this.selectedOrgId) return;
    
    this.loading = true;
    try {
      const result = await this.adminService.switchOrg(this.selectedOrgId).toPromise();
      if (result?.activeOrgId) {
        // Store active org ID in localStorage so it persists across requests
        localStorage.setItem('activeOrgId', result.activeOrgId);
        console.log('[Admin] Switched org, stored in localStorage:', result.activeOrgId);
        
        // Update current org display
        this.currentOrgId = this.selectedOrgId;
        this.selectedOrgId = result.activeOrgId; // Ensure selectedOrgId matches
        
        // Clear plan context to force reload with new org
        this.planService.clearPlanContext();
        
        // Reload plan context immediately with new org
        // Use a small delay to ensure localStorage is set before the HTTP request
        setTimeout(() => {
          const verifyOrgId = localStorage.getItem('activeOrgId');
          console.log('[Admin] About to reload plan context, verifying localStorage:', verifyOrgId);
          this.planService.loadPlanContext();
        }, 50);
        
        const snackBarRef = this.snackBar.open('Organization switched successfully', 'Close', {
          duration: 3000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open('Failed to switch organization: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
  }

  navigateToDashboard() {
    // Clear plan context to force reload with new org
    // The header's router event listener will reload it after navigation
    this.planService.clearPlanContext();
    
    // Navigate to dashboard - no page reload, just client-side navigation
    this.router.navigate(['/dashboard']);
  }

  async toggleEmulation() {
    if (this.emulationEnabled) {
      await this.disableEmulation();
    } else {
      await this.enableEmulation();
    }
  }

  async enableEmulation() {
    this.loading = true;
    try {
      const state = await this.adminService.enableEmulation(this.emulationTier).toPromise();
      if (state) {
        this.emulationEnabled = true;
        const snackBarRef = this.snackBar.open(`Emulation enabled: ${this.emulationTier}`, 'Close', {
          duration: 3000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        // Reload plan context
        this.planService.loadPlanContext();
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open('Failed to enable emulation: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
  }

  async disableEmulation() {
    this.loading = true;
    try {
      const result = await this.adminService.disableEmulation().toPromise();
      if (result?.success) {
        this.emulationEnabled = false;
        const snackBarRef = this.snackBar.open('Emulation disabled', 'Close', {
          duration: 3000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        // Reload plan context
        this.planService.loadPlanContext();
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open('Failed to disable emulation: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
  }

  async setOrgPlan(org: Org, planTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE') {
    if (!org.isInternalTest) {
      const snackBarRef = this.snackBar.open('Only internal test orgs can have their plan changed', 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
      return;
    }

    this.loading = true;
    try {
      const result = await this.adminService.setInternalOrgPlan(org.id, planTier).toPromise();
      if (result?.success) {
        const snackBarRef = this.snackBar.open(`Plan updated to ${planTier}`, 'Close', {
          duration: 3000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        await this.loadAllOrgs();
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open('Failed to update plan: ' + (error.error?.error || error.message), 'Close', {
        duration: 5000
      });
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
  }

  async upgradeOrg(org: Org, planTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE') {
    const confirmMessage = `Are you sure you want to upgrade "${org.name}" to ${planTier}? This will automatically update all entitlements.`;
    if (!confirm(confirmMessage)) {
      return;
    }

    this.loading = true;
    try {
      const result = await this.adminService.upgradeOrg(org.id, planTier, 'ACTIVE').toPromise();
      if (result?.success) {
        const snackBarRef = this.snackBar.open(
          `Organization upgraded to ${planTier}${result.entitlements ? '. Entitlements updated.' : ''}`,
          'Close',
          { duration: 5000 }
        );
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        
        // Log entitlements info if available
        if (result.entitlements) {
          console.log('[Admin] Upgrade completed. Entitlements:', {
            tier: result.entitlements.tier,
            batchIngestion: result.entitlements.batchIngestion,
            allFeatures: result.entitlements.allFeatures
          });
        }
        
        await this.loadAllOrgs();
      }
    } catch (error: any) {
      const snackBarRef = this.snackBar.open(
        'Failed to upgrade organization: ' + (error.error?.error || error.message),
        'Close',
        { duration: 5000 }
      );
      snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
    } finally {
      this.loading = false;
    }
  }

  getPlanTierColor(tier: string): string {
    switch (tier) {
      case 'SANDBOX': return 'warn';
      case 'TEAM': return 'primary';
      case 'ENTERPRISE': return 'accent';
      default: return '';
    }
  }

  // Expose Math to template
  Math = Math;
}


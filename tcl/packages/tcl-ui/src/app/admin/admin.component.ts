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
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AdminService, Org, EmulationState } from './admin.service';
import { PlanService } from '../plan.service';
import { AuthService } from '../auth.service';

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
  
  currentOrgId: string = '';
  
  private destroy$ = new Subject<void>();

  constructor(
    private adminService: AdminService,
    private planService: PlanService,
    private snackBar: MatSnackBar,
    private authService: AuthService
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
      this.allOrgs = await this.adminService.getAllOrgs().toPromise() || [];
      console.log('Loaded all orgs:', this.allOrgs.length);
      if (this.allOrgs.length === 0) {
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
    } finally {
      this.loadingAllOrgs = false;
    }
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
      const response = await fetch(`${apiUrl}/api/me`, {
        headers: {
          'Authorization': `Bearer ${await this.getAccessToken()}`
        }
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
        
        // Clear plan context to force reload with new org
        this.planService.clearPlanContext();
        
        const snackBarRef = this.snackBar.open('Organization switched successfully. Reloading...', 'Close', {
          duration: 3000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        this.currentOrgId = this.selectedOrgId;
        
        // Reload the page immediately to ensure all components pick up the new org
        // The plan context will be reloaded automatically when components initialize
        window.location.reload();
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

  getPlanTierColor(tier: string): string {
    switch (tier) {
      case 'SANDBOX': return 'warn';
      case 'TEAM': return 'primary';
      case 'ENTERPRISE': return 'accent';
      default: return '';
    }
  }
}


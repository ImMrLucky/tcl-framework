import { Component, OnInit } from '@angular/core';
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
import { AdminService, Org, EmulationState } from './admin.service';
import { PlanService } from '../plan.service';

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
export class AdminComponent implements OnInit {
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

  constructor(
    private adminService: AdminService,
    private planService: PlanService,
    private snackBar: MatSnackBar
  ) {}

  async ngOnInit() {
    await this.loadOrgs();
    await this.loadAllOrgs();
    // Get current org from plan context
    const planContext = this.planService.getPlanContext();
    // Check if emulation is active from plan context
    if (planContext && (planContext as any).emulated) {
      this.emulationEnabled = true;
      this.emulationTier = (planContext as any).effectivePlanTier || 'SANDBOX';
    }
    // We'll need to get this from /api/me response
    this.loadCurrentOrg();
  }

  async loadOrgs() {
    this.loadingOrgs = true;
    try {
      this.orgs = await this.adminService.getOrgs().toPromise() || [];
      if (this.orgs.length > 0 && !this.selectedOrgId) {
        this.selectedOrgId = this.orgs[0].id;
      }
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

  loadCurrentOrg() {
    // This would ideally come from /api/me, but for now we'll use the first org
    if (this.orgs.length > 0) {
      this.currentOrgId = this.orgs[0].id;
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
        
        const snackBarRef = this.snackBar.open('Organization switched successfully. Reloading...', 'Close', {
          duration: 3000
        });
        snackBarRef.onAction().subscribe(() => snackBarRef.dismiss());
        this.currentOrgId = this.selectedOrgId;
        
        // Reload plan context immediately (before page reload)
        this.planService.loadPlanContext();
        
        // Reload the page after a short delay to ensure all components pick up the new org
        setTimeout(() => {
          window.location.reload();
        }, 500);
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


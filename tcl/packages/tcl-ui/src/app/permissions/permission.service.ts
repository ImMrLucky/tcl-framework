import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from '../auth.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type OrgRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';

export type Permission =
  | 'view_issues'
  | 'create_issues'
  | 'update_issues'
  | 'delete_issues'
  | 'view_evaluations'
  | 'create_evaluations'
  | 'update_evaluations'
  | 'delete_evaluations'
  | 'view_cases'
  | 'create_cases'
  | 'update_cases'
  | 'delete_cases'
  | 'view_evidence'
  | 'create_evidence'
  | 'update_evidence'
  | 'delete_evidence'
  | 'view_audit_packs'
  | 'create_audit_packs'
  | 'export_data'
  | 'view_members'
  | 'manage_members'
  | 'view_integrations'
  | 'manage_integrations'
  | 'view_settings'
  | 'manage_settings'
  | 'transfer_ownership'
  | 'create_decisions'
  | 'update_decisions'
  | 'create_signoffs'
  | 'lock_issues'
  | 'unlock_issues'
  | 'create_snapshots'
  | 'view_snapshots'
  | 'create_batches'
  | 'manage_batches';

/**
 * Permission matrix: role -> permissions
 */
const PERMISSION_MATRIX: Record<OrgRole, Permission[]> = {
  VIEWER: [
    'view_issues',
    'view_evaluations',
    'view_cases',
    'view_evidence',
    'view_audit_packs',
    'view_members',
    'view_integrations',
    'view_settings',
    'view_snapshots',
  ],
  ANALYST: [
    'view_issues',
    'create_issues',
    'update_issues',
    'view_evaluations',
    'create_evaluations',
    'view_cases',
    'create_cases',
    'update_cases',
    'view_evidence',
    'create_evidence',
    'update_evidence',
    'view_audit_packs',
    'create_audit_packs',
    'export_data',
    'view_members',
    'view_integrations',
    'view_settings',
    'create_decisions',
    'update_decisions',
    'create_signoffs',
    'view_snapshots',
    'create_batches',
  ],
  MANAGER: [
    'view_issues',
    'create_issues',
    'update_issues',
    'view_evaluations',
    'create_evaluations',
    'update_evaluations',
    'view_cases',
    'create_cases',
    'update_cases',
    'view_evidence',
    'create_evidence',
    'update_evidence',
    'view_audit_packs',
    'create_audit_packs',
    'export_data',
    'view_members',
    'manage_members',
    'view_integrations',
    'view_settings',
    'manage_settings',
    'create_decisions',
    'update_decisions',
    'create_signoffs',
    'lock_issues',
    'unlock_issues',
    'view_snapshots',
    'create_batches',
    'manage_batches',
  ],
  ADMIN: [
    'view_issues',
    'create_issues',
    'update_issues',
    'delete_issues',
    'view_evaluations',
    'create_evaluations',
    'update_evaluations',
    'delete_evaluations',
    'view_cases',
    'create_cases',
    'update_cases',
    'delete_cases',
    'view_evidence',
    'create_evidence',
    'update_evidence',
    'delete_evidence',
    'view_audit_packs',
    'create_audit_packs',
    'export_data',
    'view_members',
    'manage_members',
    'view_integrations',
    'manage_integrations',
    'view_settings',
    'manage_settings',
    'create_decisions',
    'update_decisions',
    'create_signoffs',
    'lock_issues',
    'unlock_issues',
    'create_snapshots',
    'view_snapshots',
    'create_batches',
    'manage_batches',
  ],
  OWNER: [
    // Owner has all permissions
    'view_issues',
    'create_issues',
    'update_issues',
    'delete_issues',
    'view_evaluations',
    'create_evaluations',
    'update_evaluations',
    'delete_evaluations',
    'view_cases',
    'create_cases',
    'update_cases',
    'delete_cases',
    'view_evidence',
    'create_evidence',
    'update_evidence',
    'delete_evidence',
    'view_audit_packs',
    'create_audit_packs',
    'export_data',
    'view_members',
    'manage_members',
    'view_integrations',
    'manage_integrations',
    'view_settings',
    'manage_settings',
    'transfer_ownership',
    'create_decisions',
    'update_decisions',
    'create_signoffs',
    'lock_issues',
    'unlock_issues',
    'create_snapshots',
    'view_snapshots',
    'create_batches',
    'manage_batches',
  ],
};

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private currentRole$ = new BehaviorSubject<OrgRole | null>(null);
  private permissions$ = new BehaviorSubject<Permission[]>([]);

  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {
    // Load role when user changes
    this.authService.currentUser$.subscribe(async (user) => {
      if (user) {
        await this.loadUserRole();
      } else {
        this.currentRole$.next(null);
        this.permissions$.next([]);
      }
    });
  }

  /**
   * Load user's role in the current organization
   */
  async loadUserRole(): Promise<void> {
    try {
      const apiUrl = (window as any).__TCL_API_URL || 'https://protectqa.com';
      const response = await firstValueFrom(
        this.http.get<{ role?: OrgRole }>(`${apiUrl}/api/me`)
      );
      
      if (response.role) {
        this.currentRole$.next(response.role);
        this.permissions$.next(PERMISSION_MATRIX[response.role] || []);
      }
    } catch (error) {
      console.error('Failed to load user role:', error);
      this.currentRole$.next(null);
      this.permissions$.next([]);
    }
  }

  /**
   * Get current role as Observable
   */
  get currentRole(): Observable<OrgRole | null> {
    return this.currentRole$.asObservable();
  }

  /**
   * Get current permissions as Observable
   */
  get currentPermissions(): Observable<Permission[]> {
    return this.permissions$.asObservable();
  }

  /**
   * Check if user has a specific permission
   */
  hasPermission(permission: Permission): boolean {
    const permissions = this.permissions$.value;
    return permissions.includes(permission);
  }

  /**
   * Check if user has any of the specified permissions
   */
  hasAnyPermission(...permissions: Permission[]): boolean {
    const userPermissions = this.permissions$.value;
    return permissions.some(p => userPermissions.includes(p));
  }

  /**
   * Check if user has all of the specified permissions
   */
  hasAllPermissions(...permissions: Permission[]): boolean {
    const userPermissions = this.permissions$.value;
    return permissions.every(p => userPermissions.includes(p));
  }

  /**
   * Check if user has a specific role or higher
   */
  hasRoleOrHigher(role: OrgRole): boolean {
    const currentRole = this.currentRole$.value;
    if (!currentRole) return false;

    const roleHierarchy: OrgRole[] = ['VIEWER', 'ANALYST', 'MANAGER', 'ADMIN', 'OWNER'];
    const currentIndex = roleHierarchy.indexOf(currentRole);
    const requiredIndex = roleHierarchy.indexOf(role);
    
    return currentIndex >= requiredIndex;
  }

  /**
   * Get current role synchronously
   */
  getCurrentRole(): OrgRole | null {
    return this.currentRole$.value;
  }
}


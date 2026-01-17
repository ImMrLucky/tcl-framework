import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Org {
  id: string;
  name: string;
  slug: string;
  planTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE';
  planStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  isInternalTest?: boolean;
  billingMode?: 'STRIPE' | 'COMPED';
}

export interface EmulationState {
  enabled: boolean;
  planTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE';
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(private http: HttpClient) {}

  /**
   * Get list of organizations user can access
   */
  getOrgs(): Observable<Org[]> {
    return this.http.get<{ orgs: Org[] }>(`${this.apiUrl}/api/orgs`).pipe(
      map(response => response.orgs || [])
    );
  }

  /**
   * Get list of all organizations with pagination (superuser only)
   */
  getAllOrgs(options?: {
    query?: string;
    limit?: number;
    offset?: number;
    planTier?: string;
    planStatus?: string;
  }): Observable<{ orgs: Org[]; total: number; limit: number; offset: number }> {
    const params: any = {};
    if (options?.query) params.query = options.query;
    if (options?.limit) params.limit = options.limit.toString();
    if (options?.offset) params.offset = options.offset.toString();
    if (options?.planTier) params.planTier = options.planTier;
    if (options?.planStatus) params.planStatus = options.planStatus;

    const queryString = new URLSearchParams(params).toString();
    const url = `${this.apiUrl}/api/admin/orgs${queryString ? '?' + queryString : ''}`;

    return this.http.get<{ orgs: Org[]; total: number; limit: number; offset: number }>(url);
  }

  /**
   * Switch active organization
   */
  switchOrg(orgId: string): Observable<{ activeOrgId: string; org: any }> {
    return this.http.post<{ activeOrgId: string; org: any }>(
      `${this.apiUrl}/api/admin/switch-org`,
      { orgId }
    );
  }

  /**
   * Enable emulation for a plan tier
   */
  enableEmulation(planTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE'): Observable<EmulationState> {
    return this.http.post<{ emulation: EmulationState }>(
      `${this.apiUrl}/api/admin/emulation`,
      { enabled: true, planTier }
    ).pipe(
      map(response => response.emulation)
    );
  }

  /**
   * Disable emulation
   */
  disableEmulation(): Observable<{ success: boolean }> {
    return this.http.delete<{ emulation: { enabled: boolean; planTier: null } }>(`${this.apiUrl}/api/admin/emulation`).pipe(
      map(() => ({ success: true }))
    );
  }

  /**
   * Get current emulation state
   */
  getEmulationState(): Observable<EmulationState | null> {
    // This would need to be added to backend, for now return null
    return new Observable(observer => {
      observer.next(null);
      observer.complete();
    });
  }

  /**
   * Set plan tier for internal test org
   */
  setInternalOrgPlan(
    orgId: string,
    planTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE',
    planStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' = 'ACTIVE'
  ): Observable<{ success: boolean; message?: string }> {
    return this.http.post<{ success: boolean; message?: string }>(
      `${this.apiUrl}/api/admin/internal-org/plan`,
      { orgId, planTier, planStatus }
    );
  }

  /**
   * Upgrade any organization to Enterprise (or other tier)
   * This is the general upgrade endpoint for customer orgs
   */
  upgradeOrg(
    orgId: string,
    planTier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE' = 'ENTERPRISE',
    planStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' = 'ACTIVE',
    billingMode?: 'STRIPE' | 'COMPED'
  ): Observable<{
    success: boolean;
    message?: string;
    org?: {
      id: string;
      name: string;
      planTier: string;
      planStatus: string;
      billingMode?: string;
    };
    entitlements?: {
      tier: string;
      batchIngestion: boolean;
      allFeatures: Record<string, boolean>;
    };
  }> {
    return this.http.post<{
      success: boolean;
      message?: string;
      org?: any;
      entitlements?: any;
    }>(
      `${this.apiUrl}/api/admin/orgs/${orgId}/upgrade`,
      { planTier, planStatus, billingMode }
    );
  }
}


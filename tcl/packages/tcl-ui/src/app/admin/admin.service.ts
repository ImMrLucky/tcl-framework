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
   * Get list of all organizations (superuser only)
   */
  getAllOrgs(): Observable<Org[]> {
    return this.http.get<{ orgs: Org[] }>(`${this.apiUrl}/api/admin/orgs`).pipe(
      map(response => response.orgs || [])
    );
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
}


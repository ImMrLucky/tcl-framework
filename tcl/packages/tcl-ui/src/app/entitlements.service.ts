import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, tap, map } from 'rxjs/operators';

export type EntitlementTier = 'SANDBOX' | 'TEAM' | 'ENTERPRISE';

export type EntitlementFeature =
  | 'enterpriseGovernance'
  | 'approvalsWorkflow'
  | 'auditPacksAdvanced'
  | 'legalHold'
  | 'issueDecisions'
  | 'reviewerSignoff'
  | 'cases'
  | 'integrations'
  | 'batchIngestion'
  | 'connectorsS3'
  | 'connectorsDropbox'
  | 'connectorsGDrive'
  | 'ssoSaml'
  | 'scim';

export interface OrgEntitlements {
  orgId: string;
  tier: EntitlementTier;
  features: Record<EntitlementFeature, boolean>;
}

export interface EntitlementsResponse {
  entitlements: OrgEntitlements;
}

@Injectable({
  providedIn: 'root'
})
export class EntitlementsService {
  private entitlementsSubject = new BehaviorSubject<OrgEntitlements | null>(null);
  public entitlements$ = this.entitlementsSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(private http: HttpClient) {
    // Load entitlements on service initialization (after login/org select)
    // This will be called explicitly by components that need it
    
    // Listen for entitlements updates from PlanService
    if (typeof window !== 'undefined') {
      window.addEventListener('entitlementsUpdated', () => {
        this.loadFromCache();
      });
    }
  }

  /**
   * Load entitlements for the current org (from /api/me or /api/entitlements)
   * Should be called after login or org switch
   */
  loadEntitlements(orgId?: string): void {
    this.loadingSubject.next(true);

    // If orgId provided, fetch directly
    if (orgId) {
      this.http.get<EntitlementsResponse>(`${this.apiUrl}/api/entitlements`)
        .pipe(
          map(response => response.entitlements),
          tap(entitlements => {
            this.entitlementsSubject.next(entitlements);
            // Store in sessionStorage for persistence
            if (typeof window !== 'undefined' && window.sessionStorage) {
              sessionStorage.setItem('orgEntitlements', JSON.stringify(entitlements));
            }
          }),
          catchError(error => {
            console.error('Failed to load entitlements:', error);
            // Try to load from sessionStorage as fallback
            if (typeof window !== 'undefined' && window.sessionStorage) {
              const cached = sessionStorage.getItem('orgEntitlements');
              if (cached) {
                try {
                  const entitlements = JSON.parse(cached);
                  this.entitlementsSubject.next(entitlements);
                  return of(entitlements);
                } catch (e) {
                  // Invalid cache, ignore
                }
              }
            }
            return of(null);
          })
        )
        .subscribe(() => {
          this.loadingSubject.next(false);
        });
    } else {
      // Try to get from /api/me (which should include entitlements)
      this.http.get<{ entitlements?: { orgId: string; tier: EntitlementTier; features: Record<EntitlementFeature, boolean> } }>(`${this.apiUrl}/api/me`)
        .pipe(
          tap(response => {
            if (response.entitlements) {
              const entitlements: OrgEntitlements = {
                orgId: response.entitlements.orgId,
                tier: response.entitlements.tier,
                features: response.entitlements.features as Record<EntitlementFeature, boolean>,
              };
              this.entitlementsSubject.next(entitlements);
              // Store in sessionStorage
              if (typeof window !== 'undefined' && window.sessionStorage) {
                sessionStorage.setItem('orgEntitlements', JSON.stringify(entitlements));
              }
            }
          }),
          catchError(error => {
            console.error('Failed to load entitlements from /api/me:', error);
            // Try sessionStorage fallback
            if (typeof window !== 'undefined' && window.sessionStorage) {
              const cached = sessionStorage.getItem('orgEntitlements');
              if (cached) {
                try {
                  const entitlements = JSON.parse(cached);
                  this.entitlementsSubject.next(entitlements);
                } catch (e) {
                  // Invalid cache, ignore
                }
              }
            }
            return of(null);
          })
        )
        .subscribe(() => {
          this.loadingSubject.next(false);
        });
    }
  }

  /**
   * Check if current org has a specific feature
   */
  hasFeature(featureKey: EntitlementFeature): boolean {
    const entitlements = this.entitlementsSubject.value;
    if (!entitlements) {
      // Try sessionStorage
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const cached = sessionStorage.getItem('orgEntitlements');
        if (cached) {
          try {
            const cachedEntitlements = JSON.parse(cached) as OrgEntitlements;
            return cachedEntitlements.features[featureKey] || false;
          } catch (e) {
            // Invalid cache
          }
        }
      }
      return false;
    }
    return entitlements.features[featureKey] || false;
  }

  /**
   * Observable for checking if a feature is available
   */
  hasFeature$(featureKey: EntitlementFeature): Observable<boolean> {
    return this.entitlements$.pipe(
      map(entitlements => entitlements?.features[featureKey] || false)
    );
  }

  /**
   * Get current entitlements (synchronous)
   */
  getEntitlements(): OrgEntitlements | null {
    return this.entitlementsSubject.value;
  }

  /**
   * Get current tier
   */
  getTier(): EntitlementTier | null {
    const entitlements = this.entitlementsSubject.value;
    return entitlements?.tier || null;
  }

  /**
   * Clear entitlements (call on logout or org switch)
   */
  clearEntitlements(): void {
    this.entitlementsSubject.next(null);
    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.removeItem('orgEntitlements');
    }
  }

  /**
   * Load entitlements from sessionStorage on app init
   */
  loadFromCache(): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const cached = sessionStorage.getItem('orgEntitlements');
      if (cached) {
        try {
          const entitlements = JSON.parse(cached) as OrgEntitlements;
          this.entitlementsSubject.next(entitlements);
        } catch (e) {
          // Invalid cache, clear it
          sessionStorage.removeItem('orgEntitlements');
        }
      }
    }
  }
}


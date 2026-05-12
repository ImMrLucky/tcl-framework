import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, firstValueFrom } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

export type PlanTier = 'SANDBOX' | 'TEAM' | 'ENTERPRISE';
export type PlanStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
export type Capability = 
  | 'ANALYZE_MANUAL_UPLOAD'
  | 'GRAPH_VIEW'
  | 'SPECTRAL_SUMMARY'
  | 'EXPORT_JSON'
  | 'EXPORT_CSV'
  | 'API_ACCESS_SANDBOX'
  | 'API_ACCESS_PROD'
  | 'WEBHOOKS_TEST'
  | 'WEBHOOKS_PROD'
  | 'BATCH_INGEST'
  | 'CLOUD_CONNECTORS'
  | 'USAGE_DASHBOARD'
  | 'TEMPLATE_CUSTOMIZATION';

export interface PlanLimits {
  analysisRunsPerDay: number; // -1 for unlimited
  apiCallsPerDay: number;
  uploadsPerDay: number;
  maxFilesPerAnalysis: number;
  maxBytesPerFile: number; // in bytes
}

export interface PlanRemaining {
  analysisRuns: number;
  apiCalls: number;
  uploads: number;
}

export interface PlanContext {
  tier: PlanTier;
  status: PlanStatus;
  capabilities: Capability[];
  limits: PlanLimits;
  remainingToday: PlanRemaining;
  // Emulation metadata (only present when emulation is active)
  emulated?: boolean;
  realPlanTier?: PlanTier;
  effectivePlanTier?: PlanTier;
}

export interface MeResponse {
  user?: {
    id: string;
    email?: string;
    fullName?: string;
  };
  org?: {
    id: string;
    name: string;
    slug: string;
    planTier: PlanTier;
    planStatus: PlanStatus;
    isInternalTest?: boolean;
    billingMode?: string;
  };
  orgs?: Array<{
    id: string;
    name: string;
    planTier: PlanTier;
    planStatus: PlanStatus;
  }>;
  planContext?: PlanContext;
  entitlements?: {
    orgId: string;
    tier: 'SANDBOX' | 'TEAM' | 'ENTERPRISE';
    features: Record<string, boolean>;
  };
  isSuperuser?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PlanService {
  private planContextSubject = new BehaviorSubject<PlanContext | null>(null);
  public planContext$ = this.planContextSubject.asObservable();
  
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  private isSuperuserSubject = new BehaviorSubject<boolean>(false);
  public isSuperuser$ = this.isSuperuserSubject.asObservable();
  
  private loadingPromise: Promise<void> | null = null;

  private get apiUrl(): string {
    const w = typeof window !== 'undefined' ? (window as unknown as { __TCL_API_URL?: string | null }).__TCL_API_URL : undefined;
    if (w && typeof w === 'string' && w.trim().length > 0) {
      return w.trim().replace(/\/$/, '');
    }
    return '';
  }

  constructor(private http: HttpClient) {
    // Load plan context on service initialization
    this.loadPlanContext();
  }

  /**
   * Clear plan context (useful when switching orgs)
   */
  clearPlanContext(): void {
    this.planContextSubject.next(null);
  }

  /**
   * Load plan context from /api/me endpoint
   * Prevents duplicate concurrent calls by reusing an in-flight request
   */
  loadPlanContext(): void {
    // If already loading, return the existing promise instead of making a new request
    if (this.loadingPromise) {
      console.log('[PlanService] Plan context already loading, reusing existing request');
      return;
    }
    
    this.loadingSubject.next(true);
    
    // Check for active org ID in localStorage
    const activeOrgId = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;
    if (activeOrgId) {
      console.log('[PlanService] Loading plan context with active org ID:', activeOrgId);
    }
    
    // Add cache-busting query parameter to ensure fresh data
    // Also add active org ID as query parameter (fallback if header is stripped by proxy)
    const cacheBuster = new Date().getTime();
    const queryParams = activeOrgId 
      ? `?t=${cacheBuster}&activeOrgId=${encodeURIComponent(activeOrgId)}`
      : `?t=${cacheBuster}`;
    const request$ = this.http.get<MeResponse>(`${this.apiUrl}/api/me${queryParams}`)
      .pipe(
        tap(response => {
          console.log('[PlanService] Plan context loaded:', {
            tier: response.planContext?.tier,
            orgId: response.org?.id,
            orgName: response.org?.name
          });
          
          // Set activeOrgId in localStorage if we got an org back
          if (response.org?.id && typeof window !== 'undefined') {
            const currentActiveOrgId = localStorage.getItem('activeOrgId');
            if (currentActiveOrgId !== response.org.id) {
              localStorage.setItem('activeOrgId', response.org.id);
              console.log('[PlanService] Set activeOrgId in localStorage:', response.org.id);
            }
          }
          
          // Load entitlements if provided (cache in sessionStorage for EntitlementsService to pick up)
          if (response.entitlements && typeof window !== 'undefined' && window.sessionStorage) {
            sessionStorage.setItem('orgEntitlements', JSON.stringify({
              orgId: response.entitlements.orgId,
              tier: response.entitlements.tier,
              features: response.entitlements.features,
            }));
            console.log('[PlanService] Cached entitlements in sessionStorage:', {
              tier: response.entitlements.tier,
              batchIngestion: response.entitlements.features['batchIngestion'],
            });
            
            // Trigger EntitlementsService to reload from cache
            // We'll use a custom event to notify EntitlementsService
            window.dispatchEvent(new CustomEvent('entitlementsUpdated'));
          }
          
          if (response.planContext) {
            this.planContextSubject.next(response.planContext);
          }
          if (response.isSuperuser !== undefined) {
            this.isSuperuserSubject.next(response.isSuperuser);
          }
        }),
        catchError(error => {
          console.error('Failed to load plan context:', error);
          return of(null);
        })
      );
    
    this.loadingPromise = firstValueFrom(request$)
      .then(() => {
        this.loadingSubject.next(false);
        this.loadingPromise = null;
      })
      .catch(() => {
        this.loadingSubject.next(false);
        this.loadingPromise = null;
      });
  }

  /**
   * Get current plan context (synchronous)
   */
  getPlanContext(): PlanContext | null {
    return this.planContextSubject.value;
  }

  /**
   * Check if organization has a specific capability
   */
  hasCapability(capability: Capability): boolean {
    const context = this.getPlanContext();
    return context?.capabilities.includes(capability) ?? false;
  }

  /**
   * Get plan tier display name
   */
  getPlanTierDisplay(tier: PlanTier): string {
    switch (tier) {
      case 'SANDBOX':
        return 'Sandbox';
      case 'TEAM':
        return 'Team';
      case 'ENTERPRISE':
        return 'Enterprise';
      default:
        return tier;
    }
  }

  /**
   * Get plan tier color for badges
   */
  getPlanTierColor(tier: PlanTier): string {
    switch (tier) {
      case 'SANDBOX':
        return 'warn';
      case 'TEAM':
        return 'primary';
      case 'ENTERPRISE':
        return 'accent';
      default:
        return '';
    }
  }

  /**
   * Check if plan is active
   */
  isPlanActive(): boolean {
    const context = this.getPlanContext();
    return context?.status === 'ACTIVE' ?? false;
  }

  /**
   * Get remaining quota for a specific metric
   */
  getRemaining(metric: keyof PlanRemaining): number {
    const context = this.getPlanContext();
    return context?.remainingToday[metric] ?? 0;
  }

  /**
   * Get limit for a specific metric
   */
  getLimit(metric: keyof PlanLimits): number {
    const context = this.getPlanContext();
    return context?.limits[metric] ?? -1;
  }

  /**
   * Check if limit is unlimited (-1)
   */
  isUnlimited(metric: keyof PlanLimits): boolean {
    return this.getLimit(metric) === -1;
  }

  /**
   * Check if current user is a superuser
   */
  isSuperuser(): boolean {
    return this.isSuperuserSubject.value;
  }
}


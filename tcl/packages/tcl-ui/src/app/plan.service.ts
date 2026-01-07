import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
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
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    fullName?: string;
  };
  orgs: Array<{
    id: string;
    name: string;
    planTier: PlanTier;
    planStatus: PlanStatus;
  }>;
  planContext?: PlanContext;
}

@Injectable({
  providedIn: 'root'
})
export class PlanService {
  private planContextSubject = new BehaviorSubject<PlanContext | null>(null);
  public planContext$ = this.planContextSubject.asObservable();
  
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  private get apiUrl(): string {
    // Use same pattern as other services
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(private http: HttpClient) {
    // Load plan context on service initialization
    this.loadPlanContext();
  }

  /**
   * Load plan context from /api/me endpoint
   */
  loadPlanContext(): void {
    this.loadingSubject.next(true);
    
    this.http.post<MeResponse>(`${this.apiUrl}/api/me`, {})
      .pipe(
        tap(response => {
          if (response.planContext) {
            this.planContextSubject.next(response.planContext);
          }
        }),
        catchError(error => {
          console.error('Failed to load plan context:', error);
          return of(null);
        })
      )
      .subscribe(() => {
        this.loadingSubject.next(false);
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
}


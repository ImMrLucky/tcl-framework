import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ComplianceSummary {
  totalEvaluations: number;
  totalIssues: number;
  highCriticalCount: number;
  verifiedPercent: number;
  avgRiskScore: number;
}

export interface TimeseriesPoint {
  date: string;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface TimeseriesResponse {
  timeseries: TimeseriesPoint[];
}

export interface TopCategory {
  category: string;
  count: number;
}

export interface TopCategoriesResponse {
  topCategories: TopCategory[];
}

export interface TopType {
  type: string;
  count: number;
}

export interface TopTypesResponse {
  topTypes: TopType[];
}

export interface CoveragePoint {
  date: string;
  externalVerified: number;
  transcriptOnly: number;
  none: number;
  total: number;
  verifiedPercent: number;
}

export interface VerificationCoverageResponse {
  coverage: CoveragePoint[];
}

export interface IssuePattern {
  type: string;
  category: string;
  summary: string;
  count: number;
  avgScore: number;
  severityBreakdown: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
}

export interface PatternsResponse {
  patterns: IssuePattern[];
}

@Injectable({
  providedIn: 'root'
})
export class ComplianceService {
  private get apiUrl(): string {
    if (typeof window !== 'undefined') {
      if ((window as any).__TCL_API_URL) {
        return `${(window as any).__TCL_API_URL}`;
      }
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  getSummary(from: string, to: string, projectId?: string, env?: string): Observable<ComplianceSummary> {
    let params = new HttpParams()
      .set('from', from)
      .set('to', to);
    
    if (projectId) params = params.set('projectId', projectId);
    if (env) params = params.set('env', env);

    return this.http.get<ComplianceSummary>(`${this.apiUrl}/analytics/compliance/summary`, { params });
  }

  getTimeseries(from: string, to: string, bucket: 'day' | 'week' = 'day', projectId?: string, env?: string): Observable<TimeseriesResponse> {
    let params = new HttpParams()
      .set('from', from)
      .set('to', to)
      .set('bucket', bucket);
    
    if (projectId) params = params.set('projectId', projectId);
    if (env) params = params.set('env', env);

    return this.http.get<TimeseriesResponse>(`${this.apiUrl}/analytics/compliance/timeseries`, { params });
  }

  getTopCategories(from: string, to: string, projectId?: string, env?: string): Observable<TopCategoriesResponse> {
    let params = new HttpParams()
      .set('from', from)
      .set('to', to);
    
    if (projectId) params = params.set('projectId', projectId);
    if (env) params = params.set('env', env);

    return this.http.get<TopCategoriesResponse>(`${this.apiUrl}/analytics/compliance/top-categories`, { params });
  }

  getTopTypes(from: string, to: string, projectId?: string, env?: string): Observable<TopTypesResponse> {
    let params = new HttpParams()
      .set('from', from)
      .set('to', to);
    
    if (projectId) params = params.set('projectId', projectId);
    if (env) params = params.set('env', env);

    return this.http.get<TopTypesResponse>(`${this.apiUrl}/analytics/compliance/top-types`, { params });
  }

  getVerificationCoverage(from: string, to: string, bucket: 'day' | 'week' = 'day', projectId?: string, env?: string): Observable<VerificationCoverageResponse> {
    let params = new HttpParams()
      .set('from', from)
      .set('to', to)
      .set('bucket', bucket);
    
    if (projectId) params = params.set('projectId', projectId);
    if (env) params = params.set('env', env);

    return this.http.get<VerificationCoverageResponse>(`${this.apiUrl}/analytics/compliance/verification-coverage`, { params });
  }

  getPatterns(from: string, to: string, projectId?: string, env?: string): Observable<PatternsResponse> {
    let params = new HttpParams()
      .set('from', from)
      .set('to', to);
    
    if (projectId) params = params.set('projectId', projectId);
    if (env) params = params.set('env', env);

    return this.http.get<PatternsResponse>(`${this.apiUrl}/analytics/compliance/patterns`, { params });
  }
}


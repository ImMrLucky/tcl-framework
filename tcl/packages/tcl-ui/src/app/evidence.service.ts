import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface EvidenceCoverage {
  totalIssues: number;
  externalVerified: number;
  transcriptOnly: number;
  none: number;
  verifiedPercent: number;
  transcriptOnlyPercent: number;
  unverifiedPercent: number;
  byCategory: Record<string, {
    total: number;
    externalVerified: number;
    transcriptOnly: number;
    none: number;
  }>;
  byType: Record<string, {
    total: number;
    externalVerified: number;
    transcriptOnly: number;
    none: number;
  }>;
}

export interface EvidenceGap {
  evidence: string;
  count: number;
  categories: string[];
  types: string[];
  examples: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface EvidenceGapsResponse {
  gaps: EvidenceGap[];
}

@Injectable({
  providedIn: 'root'
})
export class EvidenceService {
  private get apiUrl(): string {
    if (typeof window !== 'undefined') {
      if ((window as any).__TCL_API_URL) {
        return `${(window as any).__TCL_API_URL}`;
      }
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  getCoverage(filters?: { from?: string; to?: string; projectId?: string; env?: string }): Observable<EvidenceCoverage> {
    let params = new HttpParams();
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.projectId) params = params.set('projectId', filters.projectId);
    if (filters?.env) params = params.set('env', filters.env);

    return this.http.get<EvidenceCoverage>(`${this.apiUrl}/evidence/coverage`, { params });
  }

  getGaps(filters?: { from?: string; to?: string; projectId?: string; env?: string }): Observable<EvidenceGapsResponse> {
    let params = new HttpParams();
    if (filters?.from) params = params.set('from', filters.from);
    if (filters?.to) params = params.set('to', filters.to);
    if (filters?.projectId) params = params.set('projectId', filters.projectId);
    if (filters?.env) params = params.set('env', filters.env);

    return this.http.get<EvidenceGapsResponse>(`${this.apiUrl}/evidence/gaps`, { params });
  }
}


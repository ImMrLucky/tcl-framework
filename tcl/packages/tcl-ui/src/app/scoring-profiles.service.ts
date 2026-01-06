import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ScoringProfile {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  risk_ranking_config: any;
  issue_scoring_config: any;
  config_hash: string;
  version: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
  activated_at?: string;
}

export interface CreateScoringProfileRequest {
  name: string;
  description?: string;
  riskRankingConfig: any;
  issueScoringConfig: any;
  version?: string;
}

export interface ValidationError {
  error: string;
  errors?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ScoringProfilesService {
  private get apiUrl(): string {
    if (typeof window !== 'undefined') {
      if ((window as any).__TCL_API_URL) {
        return `${(window as any).__TCL_API_URL}`;
      }
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  getProfiles(): Observable<{ profiles: ScoringProfile[] }> {
    return this.http.get<{ profiles: ScoringProfile[] }>(`${this.apiUrl}/admin/scoring-profiles`);
  }

  getActiveProfile(): Observable<{ profile: ScoringProfile | null }> {
    return this.http.get<{ profile: ScoringProfile | null }>(`${this.apiUrl}/admin/scoring-profiles/active`);
  }

  createProfile(request: CreateScoringProfileRequest): Observable<{ profile: ScoringProfile }> {
    return this.http.post<{ profile: ScoringProfile }>(`${this.apiUrl}/admin/scoring-profiles`, request);
  }

  activateProfile(id: string): Observable<{ profile: ScoringProfile; message: string; configHash: string }> {
    return this.http.post<{ profile: ScoringProfile; message: string; configHash: string }>(
      `${this.apiUrl}/admin/scoring-profiles/${id}/activate`,
      {}
    );
  }
}


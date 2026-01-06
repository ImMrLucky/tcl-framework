import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Policy {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'archived';
  version: string;
  content: string;
  metadata?: Record<string, any>;
  created_by?: string;
  created_at: string;
  updated_at: string;
  activated_at?: string;
  archived_at?: string;
}

export interface PolicyVersion {
  id: string;
  version: string;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
  activated_at?: string;
  archived_at?: string;
}

export interface PolicySource {
  id: string;
  policy_id: string;
  source_id: string;
  section?: string;
  relevance_score?: number;
  created_at: string;
  sources?: any;
}

export interface IssuePolicyLink {
  id: string;
  issue_id: string;
  policy_id: string;
  link_type: 'references' | 'violates' | 'complies';
  section?: string;
  created_at: string;
}

export interface PolicyDetail {
  policy: Policy;
  versions: PolicyVersion[];
  sources: PolicySource[];
  issueLinks: IssuePolicyLink[];
}

@Injectable({
  providedIn: 'root'
})
export class PoliciesService {
  private get apiUrl(): string {
    if (typeof window !== 'undefined') {
      if ((window as any).__TCL_API_URL) {
        return `${(window as any).__TCL_API_URL}`;
      }
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  createPolicy(policy: { name: string; description?: string; content: string; version?: string; metadata?: Record<string, any> }): Observable<{ policy: Policy }> {
    return this.http.post<{ policy: Policy }>(`${this.apiUrl}/policies`, policy);
  }

  getPolicies(filters?: { status?: string; name?: string }): Observable<{ policies: Policy[] }> {
    let params = new HttpParams();
    if (filters?.status) params = params.set('status', filters.status);
    if (filters?.name) params = params.set('name', filters.name);

    return this.http.get<{ policies: Policy[] }>(`${this.apiUrl}/policies`, { params });
  }

  getPolicy(id: string): Observable<PolicyDetail> {
    return this.http.get<PolicyDetail>(`${this.apiUrl}/policies/${id}`);
  }

  updatePolicy(id: string, updates: Partial<Policy>): Observable<{ policy: Policy }> {
    return this.http.put<{ policy: Policy }>(`${this.apiUrl}/policies/${id}`, updates);
  }

  activatePolicy(id: string): Observable<{ policy: Policy }> {
    return this.http.post<{ policy: Policy }>(`${this.apiUrl}/policies/${id}/activate`, {});
  }

  archivePolicy(id: string): Observable<{ policy: Policy }> {
    return this.http.post<{ policy: Policy }>(`${this.apiUrl}/policies/${id}/archive`, {});
  }
}


import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface IssueV2 {
  issueId: string;
  issueKey: string;
  runId: string;
  conversationId: string;
  type: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  severityDisplay?: 'low' | 'medium' | 'high';
  impact?: 'low' | 'medium' | 'high';
  riskScore: number;
  score?: number;
  confidence: number;
  reviewRequired: boolean;
  verification: {
    level: 'EXTERNAL_VERIFIED' | 'TRANSCRIPT_ONLY' | 'NONE';
    reasonCodes: string[];
  };
  who: {
    speaker: string;
    turnIndex?: number;
  };
  what: {
    primaryClaimId: string;
    relatedClaimIds?: string[];
    claimText?: string;
    issueSummary: string;
    issueDetail: string;
  };
  evidence: {
    refs: Array<{
      sourceType: string;
      sourceId: string;
      quote: string;
      weight?: number;
      turnIndex?: number;
    }>;
    edges?: Array<{
      kind: string;
      claimA: string;
      claimB?: string;
      weight: number;
    }>;
  };
  compliance: {
    tags: string[];
    impactedPolicies?: Array<{ policyId: string; section?: string }>;
    legalHoldSuggested?: boolean;
    disclaimers: string[];
  };
  audit: {
    createdAt: string;
    engineVersion: string;
    scorerId: string;
    modelFingerprint?: any;
    configHash?: string;
    inputHash?: string;
  };
  // Workflow fields
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
  assigneeUserId?: string | null;
  workflowUpdatedAt?: string | null;
  evaluationId?: string;
  evaluationCreatedAt?: string;
}

export interface IssuesListResponse {
  issues: IssueV2[];
  total: number;
  limit: number;
  offset: number;
}

export interface IssueActivityItem {
  type: 'comment' | 'action';
  id: string;
  actor: {
    id: string;
    email?: string;
    full_name?: string;
  };
  body?: string;
  actionType?: string;
  payload?: any;
  createdAt: string;
}

export interface IssueActivityResponse {
  activity: IssueActivityItem[];
}

export interface IssueFilters {
  status?: string;
  severityDisplay?: string;
  verificationLevel?: string;
  category?: string;
  type?: string;
  assigneeUserId?: string;
  dateFrom?: string;
  dateTo?: string;
  evaluationId?: string;
  limit?: number;
  offset?: number;
}

@Injectable({
  providedIn: 'root'
})
export class IssuesService {
  private get apiUrl(): string {
    if (typeof window !== 'undefined') {
      if ((window as any).__TCL_API_URL) {
        return `${(window as any).__TCL_API_URL}`;
      }
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  getIssues(filters: IssueFilters = {}): Observable<IssuesListResponse> {
    let params = new HttpParams();
    
    if (filters.status) params = params.set('status', filters.status);
    if (filters.severityDisplay) params = params.set('severityDisplay', filters.severityDisplay);
    if (filters.verificationLevel) params = params.set('verificationLevel', filters.verificationLevel);
    if (filters.category) params = params.set('category', filters.category);
    if (filters.type) params = params.set('type', filters.type);
    if (filters.assigneeUserId) params = params.set('assigneeUserId', filters.assigneeUserId);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    if (filters.evaluationId) params = params.set('evaluationId', filters.evaluationId);
    if (filters.limit) params = params.set('limit', filters.limit.toString());
    if (filters.offset) params = params.set('offset', filters.offset.toString());

    return this.http.get<IssuesListResponse>(`${this.apiUrl}/issues-v2`, { params });
  }

  updateStatus(issueId: string, status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE'): Observable<any> {
    return this.http.post(`${this.apiUrl}/issues-v2/${issueId}/status`, { status });
  }

  assignIssue(issueId: string, assigneeUserId: string | null): Observable<any> {
    return this.http.post(`${this.apiUrl}/issues-v2/${issueId}/assign`, { assigneeUserId });
  }

  addComment(issueId: string, body: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/issues-v2/${issueId}/comment`, { body });
  }

  getActivity(issueId: string): Observable<IssueActivityResponse> {
    return this.http.get<IssueActivityResponse>(`${this.apiUrl}/issues-v2/${issueId}/activity`);
  }

  bulkAction(issueIds: string[], action: 'status' | 'assign', payload: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/issues-v2/bulk`, { issueIds, action, payload });
  }
}


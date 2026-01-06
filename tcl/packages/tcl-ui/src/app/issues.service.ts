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

// Pattern Queue Interfaces
export interface IssuePatternRow {
  patternKey: string;
  title: string;
  summary: string;
  category: string;
  type: string;
  impact?: 'low' | 'medium' | 'high';
  severity: 'low' | 'medium' | 'high' | 'critical';
  severityDisplay: 'low' | 'medium' | 'high' | 'critical';
  occurrences: number;
  uniqueAgents?: number;
  uniqueCustomers?: number;
  verificationCounts: {
    EXTERNAL_VERIFIED: number;
    TRANSCRIPT_ONLY: number;
    NONE: number;
  };
  lastSeenAt: string;
  firstSeenAt: string;
  trend: {
    direction: 'up' | 'down' | 'flat';
    pctChange: number;
    window: string;
  };
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
  assignee?: string | null;
  priorityScore: number;
  avgRiskScore: number;
  maxRiskScore: number;
}

export interface IssueQueueResponse {
  rows: IssuePatternRow[];
  total: number;
  page: number;
  pageSize: number;
  diagnostics?: { mode?: string; warnings?: string[] };
}

export interface IssuePatternOccurrence {
  evaluationId: string;
  conversationId: string;
  occurredAt: string;
  riskScore: number;
  score?: number;
  severityDisplay: 'low' | 'medium' | 'high' | 'critical';
  verificationLevel: 'EXTERNAL_VERIFIED' | 'TRANSCRIPT_ONLY' | 'NONE';
  who: {
    speaker: string;
    turnIndex?: number;
  };
  what: {
    primaryClaimId: string;
    issueSummary: string;
    claimText?: string;
  };
  evidencePreview: Array<{
    sourceType: string;
    quote: string;
    turnIndex?: number;
  }>;
  tracePreview?: {
    contradictionPairs?: Array<{
      claimA: string;
      claimB: string;
      weight: number;
    }>;
  };
}

export interface IssuePatternDetail {
  patternKey: string;
  title: string;
  summary: string;
  recommendedActions?: string[];
  occurrences: number;
  verificationCounts: IssuePatternRow['verificationCounts'];
  status: IssuePatternRow['status'];
  assignee?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrencesList: IssuePatternOccurrence[];
  traceability?: {
    topEdges: Array<{
      kind: string;
      claimA: string;
      claimB?: string;
      weight: number;
    }>;
  };
  scoring?: any;
}

export interface QueueFilters {
  from?: string;
  to?: string;
  severity?: string;
  verification?: string;
  status?: string;
  type?: string;
  category?: string;
  assignee?: string;
  q?: string;
  page?: number;
  pageSize?: number;
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

  // Pattern Queue Methods
  getIssueQueue(filters: QueueFilters = {}): Observable<IssueQueueResponse> {
    let params = new HttpParams();
    
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.severity) params = params.set('severity', filters.severity);
    if (filters.verification) params = params.set('verification', filters.verification);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.type) params = params.set('type', filters.type);
    if (filters.category) params = params.set('category', filters.category);
    if (filters.assignee) params = params.set('assignee', filters.assignee);
    if (filters.q) params = params.set('q', filters.q);
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.pageSize) params = params.set('pageSize', filters.pageSize.toString());

    return this.http.get<IssueQueueResponse>(`${this.apiUrl}/issues/queue`, { params });
  }

  getPatternDetail(patternKey: string): Observable<IssuePatternDetail> {
    return this.http.get<IssuePatternDetail>(`${this.apiUrl}/issues/pattern/${patternKey}`);
  }

  updatePattern(patternKey: string, patch: { status?: string; assignee?: string | null }): Observable<any> {
    return this.http.patch(`${this.apiUrl}/issues/pattern/${patternKey}`, patch);
  }

  exportQueue(format: 'csv' | 'json', filters: QueueFilters = {}): string {
    let params = new HttpParams();
    
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.severity) params = params.set('severity', filters.severity);
    if (filters.verification) params = params.set('verification', filters.verification);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.type) params = params.set('type', filters.type);
    if (filters.category) params = params.set('category', filters.category);
    if (filters.assignee) params = params.set('assignee', filters.assignee);
    if (filters.q) params = params.set('q', filters.q);

    return `${this.apiUrl}/issues/queue/export/${format}?${params.toString()}`;
  }
}


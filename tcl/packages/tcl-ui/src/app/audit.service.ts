import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ConversationIngestRequest {
  transcript: string;
  title?: string;
  channel?: 'call' | 'chat' | 'email' | 'other';
  externalId?: string;
  metadata?: Record<string, any>;
}

export interface ConversationIngestResponse {
  conversationId: string;
  conversation: {
    id: string;
    org_id: string;
    project_id: string;
    env: string;
    title: string | null;
    created_at: string;
  };
}

export interface ConversationCreateRequest {
  title?: string;
  content: string;
  externalId?: string;
  metadata?: Record<string, any>;
}

export interface ConversationCreateResponse {
  conversation: {
    id: string;
    org_id: string;
    project_id: string;
    env: string;
    title: string | null;
    created_at: string;
  };
}

export interface EvaluationRunRequest {
  conversationId: string;
  claims: Array<{
    id: string;
    text: string;
    speaker?: string;
    turnIndex?: number;
  }>;
  supports: Array<{
    claimA: string;
    claimB: string;
    weight?: number;
  }>;
  contradictions: Array<{
    claimA: string;
    claimB: string;
    weight?: number;
  }>;
  grounded: string[];
  config?: {
    wSupport?: number;
    wContradiction?: number;
    wCircularity?: number;
    cycleMaxLen?: number;
    alpha?: number;
    tau?: number;
  };
  sources?: Array<{ id: string; text: string }>;
}

export interface EvaluationRunResponse {
  evaluationId: string;
  conversationId: string;
  inputHash: string;
  configHash: string;
  latency: number;
}

export interface Evaluation {
  id: string;
  org_id: string;
  project_id: string;
  env: string;
  conversation_id: string;
  scores: any;
  refusal: boolean;
  scorer_id: string | null;
  engine_version: string;
  latency_ms: number;
  report: any;
  created_at: string;
}

export interface Issue {
  claimId: string;
  truthState: 'Contradicted' | 'Supported' | 'Ungrounded' | 'Inconclusive';
  nodeBlameNorm: number;
  importance: number;
  issueType: 'CONTRADICTION' | 'UNSUPPORTED' | 'POLICY_MISS' | 'POLICY_VIOLATION';
  speaker: 'AGENT' | 'CUSTOMER' | 'UNKNOWN';
  turnStartIdx?: number;
  turnEndIdx?: number;
  primaryEvidence?: {
    turnIdx: number;
    speaker: string;
    excerpt: string;
  };
  relatedEdges: {
    topBadContradictions: any[];
    topBadSupports: any[];
  };
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
}

export interface ExportResponse {
  artifactId: string;
  downloadUrl: string;
  checksum: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuditService {
  private get apiBase(): string {
    // Use the same API base URL logic as TclService
    if (typeof window !== 'undefined' && (window as any).__TCL_API_URL) {
      return (window as any).__TCL_API_URL;
    }
    return '/api';
  }

  /**
   * Get the API base URL (public method for components that need it)
   */
  getApiBaseUrl(): string {
    return this.apiBase;
  }

  constructor(private http: HttpClient) {}

  /**
   * Ingest a conversation (transcript) - DEPRECATED: Use createConversation instead
   */
  ingestConversation(request: ConversationIngestRequest): Observable<ConversationIngestResponse> {
    // Convert to new format
    return this.createConversation({
      title: request.title,
      content: request.transcript,
      externalId: request.externalId,
      metadata: {
        ...request.metadata,
        channel: request.channel
      }
    }).pipe(
      map(response => ({
        conversationId: response.conversation.id,
        conversation: response.conversation
      }))
    );
  }

  /**
   * Create a conversation (new REST endpoint)
   */
  createConversation(request: ConversationCreateRequest): Observable<ConversationCreateResponse> {
    return this.http.post<ConversationCreateResponse>(
      `${this.apiBase}/conversations`,
      request
    );
  }

  /**
   * Get conversations
   */
  getConversations(params?: {
    limit?: number;
    offset?: number;
    projectId?: string;
    env?: string;
  }): Observable<{ conversations: Array<{
    id: string;
    org_id: string;
    project_id: string;
    env: string;
    external_id: string | null;
    title: string | null;
    created_at: string;
  }> }> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());
    if (params?.projectId) queryParams.set('projectId', params.projectId);
    if (params?.env) queryParams.set('env', params.env);
    
    const query = queryParams.toString();
    return this.http.get<{ conversations: Array<any> }>(
      `${this.apiBase}/conversations${query ? '?' + query : ''}`
    );
  }

  /**
   * Get evaluations for a conversation
   */
  getConversationEvaluations(conversationId: string, params?: {
    limit?: number;
    offset?: number;
  }): Observable<{ evaluations: Evaluation[] }> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());
    
    const query = queryParams.toString();
    return this.http.get<{ evaluations: Evaluation[] }>(
      `${this.apiBase}/conversations/${conversationId}/evaluations${query ? '?' + query : ''}`
    );
  }

  /**
   * Run an evaluation with full reproducibility manifest
   */
  runEvaluation(request: EvaluationRunRequest): Observable<EvaluationRunResponse> {
    return this.http.post<EvaluationRunResponse>(
      `${this.apiBase}/evaluations/run`,
      request
    );
  }

  /**
   * Get evaluation by ID
   */
  getEvaluation(evaluationId: string): Observable<{ evaluation: Evaluation }> {
    return this.http.get<{ evaluation: Evaluation }>(
      `${this.apiBase}/evaluations/${evaluationId}`
    );
  }

  /**
   * Get issues for an evaluation
   */
  getIssues(evaluationId: string): Observable<{ issues: Issue[] }> {
    return this.http.get<{ issues: Issue[] }>(
      `${this.apiBase}/evaluations/${evaluationId}/issues`
    );
  }

  /**
   * Export Claims CSV
   */
  exportClaimsCSV(evaluationId: string): Observable<ExportResponse> {
    return this.http.post<ExportResponse>(
      `${this.apiBase}/exports/claims-csv`,
      { evaluation_id: evaluationId }
    );
  }

  /**
   * Export Run JSON Bundle
   */
  exportRunJSON(evaluationId: string): Observable<ExportResponse> {
    return this.http.post<ExportResponse>(
      `${this.apiBase}/exports/run-json`,
      { evaluation_id: evaluationId }
    );
  }

  /**
   * Export Single Issue PDF
   */
  exportIssuePDF(evaluationId: string, claimId: string): Observable<ExportResponse> {
    return this.http.post<ExportResponse>(
      `${this.apiBase}/exports/issue-pdf`,
      { evaluation_id: evaluationId, claim_id: claimId }
    );
  }

  /**
   * Get conversation transcript with turns
   */
  getConversationTranscript(conversationId: string): Observable<{ raw_text: string; turns: Array<{ idx: number; speaker: string; text: string; startMs?: number; endMs?: number }> }> {
    return this.http.get<{ raw_text: string; turns: Array<{ idx: number; speaker: string; text: string; startMs?: number; endMs?: number }> }>(
      `${this.apiBase}/conversations/${conversationId}/transcript`
    );
  }

  /**
   * Update issue status
   */
  updateIssueStatus(evaluationId: string, claimId: string, status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE'): Observable<{ success: boolean; issue: Issue }> {
    return this.http.patch<{ success: boolean; issue: Issue }>(
      `${this.apiBase}/evaluations/${evaluationId}/issues/${claimId}`,
      { status }
    );
  }
}


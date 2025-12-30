import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

  constructor(private http: HttpClient) {}

  /**
   * Ingest a conversation (transcript)
   */
  ingestConversation(request: ConversationIngestRequest): Observable<ConversationIngestResponse> {
    return this.http.post<ConversationIngestResponse>(
      `${this.apiBase}/conversations/ingest`,
      request
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


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

// Ingestion Job Types
export interface CreateIngestionJobRequest {
  mode: 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT';
  title?: string;
  channel?: string;
  options?: {
    analyzeImmediately?: boolean;
  };
}

export interface CreateIngestionJobResponse {
  jobId: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'UPLOADED' | 'READY' | 'TRANSCRIBING' | 'ANALYZING' | 'VERIFYING' | 'COMPLETE' | 'FAILED';
  progress: {
    stage: string | null;
    pct: number;
  };
  result: {
    analysisRunId: string | null;
    verificationReportId: string | null;
  };
  error?: {
    code: string;
    message: string;
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
  issueId?: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
  
  // Nested structure from DefensibleIssue (new format)
  who?: {
    speaker: 'AGENT' | 'CUSTOMER' | 'UNKNOWN' | 'SYSTEM';
    speakerLabel: string;
  };
  what?: {
    claimText: string;
    claimSummary: string;
    issueType: 'CONTRADICTION' | 'UNSUPPORTED' | 'POLICY_MISS' | 'POLICY_VIOLATION' | 'CIRCULAR' | 'VAGUE_LANGUAGE' | 'LATE_DISCLAIMER';
    truthState: 'Contradicted' | 'Supported' | 'Ungrounded' | 'Inconclusive';
    description: string;
    whyFlagged: string;
  };
  where?: {
    turnStartIdx?: number;
    turnEndIdx?: number;
    timestampStartMs?: number;
    timestampEndMs?: number;
    excerpt: string;
  };
  risk?: {
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    explanation: string;
    policyRuleIds?: string[];
  };
  confidence?: {
    nodeBlameNorm: number;
    importance: number;
    nliScore?: number;
    groundingScore?: number;
  };
  conflictsWith?: Array<{
    claimId: string;
    relationshipType: 'contradiction' | 'unsupported_by';
    weight: number;
    claimText?: string;
  }>;
  
  // Legacy flat fields (for backward compatibility)
  truthState?: 'Contradicted' | 'Supported' | 'Ungrounded' | 'Inconclusive';
  nodeBlameNorm?: number;
  importance?: number;
  issueType?: 'CONTRADICTION' | 'UNSUPPORTED' | 'POLICY_MISS' | 'POLICY_VIOLATION' | 'CIRCULAR' | 'VAGUE_LANGUAGE' | 'LATE_DISCLAIMER';
  speaker?: 'AGENT' | 'CUSTOMER' | 'UNKNOWN' | 'SYSTEM';
  speakerLabel?: string;
  turnStartIdx?: number;
  turnEndIdx?: number;
  claimText?: string;
  claimSummary?: string;
  description?: string;
  whyFlagged?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  riskCategory?: string;
  riskExplanation?: string;
  evidenceLocation?: string;
  primaryEvidence?: {
    turnIdx: number;
    speaker: string;
    excerpt: string;
  };
  relatedEdges?: {
    topBadContradictions: any[];
    topBadSupports: any[];
  };
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
   * Get the evaluation service URL (Railway direct for long-running operations)
   * This bypasses Netlify's 30-second function timeout.
   */
  private get evaluationBase(): string {
    if (typeof window !== 'undefined') {
      // First check for dedicated evaluation URL (Railway)
      if ((window as any).__TCL_EVALUATION_URL) {
        return (window as any).__TCL_EVALUATION_URL;
      }
      // Fall back to API URL
      if ((window as any).__TCL_API_URL) {
        return (window as any).__TCL_API_URL;
      }
    }
    return '/api';
  }

  /**
   * Get the API base URL (public method for components that need it)
   */
  getApiBaseUrl(): string {
    return this.apiBase;
  }

  /**
   * Get the evaluation service URL (for long-running operations like /validate)
   */
  getEvaluationBaseUrl(): string {
    return this.evaluationBase;
  }

  /**
   * Create an ingestion job
   */
  createIngestionJob(request: CreateIngestionJobRequest): Observable<CreateIngestionJobResponse> {
    return this.http.post<CreateIngestionJobResponse>(`${this.apiBase}/ingest/jobs`, request);
  }

  /**
   * Get upload metadata for direct Supabase upload
   */
  getUploadMetadata(jobId: string, kind: 'audio' | 'transcript', filename: string): Observable<{
    bucket: string;
    objectPath: string;
    assetId: string;
    supabaseUrl: string;
  }> {
    return this.http.post<{
      bucket: string;
      objectPath: string;
      assetId: string;
      supabaseUrl: string;
    }>(`${this.apiBase}/ingest/jobs/${jobId}/upload-metadata`, { kind, filename });
  }

  /**
   * Finalize upload after direct Supabase upload completes
   */
  finalizeUpload(
    jobId: string,
    assetId: string,
    bucket: string,
    objectPath: string,
    filename: string,
    sizeBytes: number,
    sha256: string,
    kind: 'audio' | 'transcript'
  ): Observable<{ success: boolean; assetId: string }> {
    return this.http.post<{ success: boolean; assetId: string }>(
      `${this.apiBase}/ingest/jobs/${jobId}/finalize-upload`,
      { assetId, bucket, objectPath, filename, sizeBytes, sha256, kind }
    );
  }

  /**
   * Start processing a READY job (for Audio Only mode)
   */
  startJob(jobId: string): Observable<{ ok: boolean; alreadyProcessing?: boolean; alreadyComplete?: boolean }> {
    return this.http.post<{ ok: boolean; alreadyProcessing?: boolean; alreadyComplete?: boolean }>(
      `${this.apiBase}/ingest/jobs/${jobId}/start`,
      {}
    );
  }

  /**
   * Upload files for an ingestion job (legacy - uses proxy, may fail for large files)
   * @deprecated Use direct Supabase upload instead (getUploadMetadata + upload to Supabase + finalizeUpload)
   */
  uploadJobFiles(jobId: string, audioFile?: File, transcriptFile?: File): Observable<{ success: boolean }> {
    const formData = new FormData();
    
    if (audioFile) {
      formData.append('audio', audioFile);
    }
    if (transcriptFile) {
      formData.append('transcript', transcriptFile);
    }

    return this.http.post<{ success: boolean }>(`${this.apiBase}/ingest/jobs/${jobId}/upload`, formData);
  }

  /**
   * Get ingestion job status
   */
  getJobStatus(jobId: string): Observable<JobStatusResponse> {
    return this.http.get<JobStatusResponse>(`${this.apiBase}/ingest/jobs/${jobId}`);
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
   * Get all evaluations for the organization (for history view)
   */
  getEvaluations(limit?: number, offset?: number): Observable<{ evaluations: Evaluation[]; total?: number }> {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.set('limit', limit.toString());
    if (offset) queryParams.set('offset', offset.toString());
    
    const query = queryParams.toString();
    return this.http.get<{ evaluations: Evaluation[]; total?: number }>(
      `${this.apiBase}/evaluations${query ? '?' + query : ''}`
    );
  }

  /**
   * Search evaluations with filters (server-side)
   */
  searchEvaluations(filters: {
    limit?: number;
    offset?: number;
    dateFrom?: string;
    dateTo?: string;
    severityDisplay?: string;
    verification?: string;
    category?: string;
    type?: string;
    agent?: string;
    team?: string;
    textContains?: string;
    projectId?: string;
    env?: string;
  }): Observable<{ evaluations: any[]; total: number; limit: number; offset: number }> {
    const queryParams = new URLSearchParams();
    if (filters.limit) queryParams.set('limit', filters.limit.toString());
    if (filters.offset) queryParams.set('offset', filters.offset.toString());
    if (filters.dateFrom) queryParams.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) queryParams.set('dateTo', filters.dateTo);
    if (filters.severityDisplay) queryParams.set('severityDisplay', filters.severityDisplay);
    if (filters.verification) queryParams.set('verification', filters.verification);
    if (filters.category) queryParams.set('category', filters.category);
    if (filters.type) queryParams.set('type', filters.type);
    if (filters.agent) queryParams.set('agent', filters.agent);
    if (filters.team) queryParams.set('team', filters.team);
    if (filters.textContains) queryParams.set('textContains', filters.textContains);
    if (filters.projectId) queryParams.set('projectId', filters.projectId);
    if (filters.env) queryParams.set('env', filters.env);

    const query = queryParams.toString();
    return this.http.get<{ evaluations: any[]; total: number; limit: number; offset: number }>(
      `${this.apiBase}/evaluations/search${query ? '?' + query : ''}`
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

  /**
   * Create a simulation from an existing evaluation
   * This creates a NEW evaluation with mode="SIMULATION" and links to the parent
   * The original evaluation remains IMMUTABLE
   */
  createSimulation(
    parentEvaluationId: string,
    modifications: {
      addClaims?: Array<{ id?: string; text: string; speaker?: string; turnIndex?: number }>;
      removeClaims?: string[];
      addSupports?: Array<{ claimA: string; claimB: string; weight?: number }>;
      removeSupports?: Array<{ claimA: string; claimB: string }>;
      addContradictions?: Array<{ claimA: string; claimB: string; weight?: number }>;
      removeContradictions?: Array<{ claimA: string; claimB: string }>;
      addGrounded?: string[];
      removeGrounded?: string[];
    },
    description?: string
  ): Observable<{
    success: boolean;
    evaluationId: string;
    parentEvaluationId: string;
    mode: 'SIMULATION';
    expiresAt: string;
    inputHash: string;
    configHash: string;
    latency: number;
  }> {
    return this.http.post<any>(
      `${this.apiBase}/evaluations/${parentEvaluationId}/simulate`,
      { modifications, description }
    );
  }

  /**
   * Delete an evaluation (SENSITIVE ACTION - requires re-authentication)
   * This permanently removes the evaluation and cannot be undone.
   */
  deleteEvaluation(evaluationId: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.apiBase}/evaluations/${evaluationId}`
    );
  }

  /**
   * Get issue queue (pattern aggregation)
   */
  getIssueQueue(filters: {
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
  }): Observable<{
    rows: any[];
    total: number;
    page: number;
    pageSize: number;
    diagnostics?: { mode?: string; warnings?: string[] };
  }> {
    const queryParams = new URLSearchParams();
    if (filters.from) queryParams.set('from', filters.from);
    if (filters.to) queryParams.set('to', filters.to);
    if (filters.severity) queryParams.set('severity', filters.severity);
    if (filters.verification) queryParams.set('verification', filters.verification);
    if (filters.status) queryParams.set('status', filters.status);
    if (filters.type) queryParams.set('type', filters.type);
    if (filters.category) queryParams.set('category', filters.category);
    if (filters.assignee) queryParams.set('assignee', filters.assignee);
    if (filters.q) queryParams.set('q', filters.q);
    if (filters.page) queryParams.set('page', filters.page.toString());
    if (filters.pageSize) queryParams.set('pageSize', filters.pageSize.toString());

    const query = queryParams.toString();
    return this.http.get<{
      rows: any[];
      total: number;
      page: number;
      pageSize: number;
      diagnostics?: { mode?: string; warnings?: string[] };
    }>(`${this.apiBase}/issues/queue${query ? '?' + query : ''}`);
  }

  /**
   * Get pattern detail for drawer
   */
  getPatternDetail(patternKey: string): Observable<any> {
    return this.http.get<any>(`${this.apiBase}/issues/pattern/${patternKey}`);
  }

  /**
   * Update pattern status/assignee
   */
  updatePattern(patternKey: string, patch: { status?: string; assignee?: string | null }): Observable<any> {
    return this.http.patch<any>(`${this.apiBase}/issues/pattern/${patternKey}`, patch);
  }
}


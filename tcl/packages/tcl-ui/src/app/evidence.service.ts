import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface EvidenceItem {
  id: string;
  orgId: string;
  projectId?: string;
  conversationId?: string;
  templateId?: string;
  scope: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION';
  sourceType: 'POLICY' | 'RULESET' | 'KNOWLEDGE' | 'ACCOUNT_FACTS' | 'LEGAL' | 'URL_LINK' | 'SYSTEM_EXPORT';
  title: string;
  description?: string;
  storageKind: 'FILE' | 'LINK';
  file?: {
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storagePath: string;
    originalName: string;
  };
  link?: {
    url: string;
    fetchedAt?: string;
    sha256?: string;
    snapshotStoragePath?: string;
  };
  status: 'DRAFT' | 'APPROVED' | 'DEPRECATED';
  version: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  tags: string[];
  regions: string[];
  indexStatus: 'PENDING' | 'INDEXED' | 'FAILED';
  chunkCount?: number;
  embeddingModel?: string;
  indexError?: string;
  ruleMeta?: any;
}

export interface CreateEvidenceItemRequest {
  orgId: string;
  projectId?: string;
  conversationId?: string;
  templateId?: string;
  scope: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION';
  sourceType: 'POLICY' | 'RULESET' | 'KNOWLEDGE' | 'ACCOUNT_FACTS' | 'LEGAL' | 'URL_LINK' | 'SYSTEM_EXPORT';
  title: string;
  description?: string;
  tags?: string[];
  regions?: string[];
  storageKind: 'FILE' | 'LINK';
  file?: File;
  linkUrl?: string;
  snapshotLink?: boolean;
  ruleMeta?: any;
}

export interface EvidenceSet {
  orgEvidenceIds: string[];
  projectEvidenceIds: string[];
  conversationEvidenceIds: string[];
  templateEvidenceIds: string[];
  resolvedEvidenceIds: string[];
}

export interface EvidenceDiagnostics {
  indexingFailures?: Array<{ evidenceItemId: string; error: string }>;
  missingApprovals?: string[];
  staleDocsUsed?: string[];
  snapshotStatus?: Array<{ evidenceItemId: string; status: string }>;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class EvidenceService {
  private get apiBase(): string {
    const apiUrl = this.authService.getApiUrl();
    return apiUrl ? `${apiUrl}/api` : '/api';
  }

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  /**
   * Upload an evidence file
   */
  uploadEvidenceFile(
    file: File,
    orgId: string,
    sourceType: EvidenceItem['sourceType'],
    title: string,
    options?: {
      projectId?: string;
      conversationId?: string;
      templateId?: string;
      scope?: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION';
      description?: string;
      tags?: string[];
      regions?: string[];
    }
  ): Observable<EvidenceItem> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('orgId', orgId);
    formData.append('sourceType', sourceType);
    formData.append('title', title);
    
    if (options?.projectId) formData.append('projectId', options.projectId);
    if (options?.conversationId) formData.append('conversationId', options.conversationId);
    if (options?.templateId) formData.append('templateId', options.templateId);
    if (options?.scope) formData.append('scope', options.scope);
    if (options?.description) formData.append('description', options.description);
    if (options?.tags) formData.append('tags', JSON.stringify(options.tags));
    if (options?.regions) formData.append('regions', JSON.stringify(options.regions));

    return this.http.post<EvidenceItem>(`${this.apiBase}/evidence/upload`, formData);
  }

  /**
   * Add an evidence link
   */
  addEvidenceLink(
    url: string,
    orgId: string,
    sourceType: EvidenceItem['sourceType'],
    title: string,
    options?: {
      projectId?: string;
      conversationId?: string;
      templateId?: string;
      scope?: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION';
      description?: string;
      tags?: string[];
      regions?: string[];
      snapshotLink?: boolean;
    }
  ): Observable<EvidenceItem> {
    return this.http.post<EvidenceItem>(`${this.apiBase}/evidence/link`, {
      url,
      orgId,
      sourceType,
      title,
      projectId: options?.projectId,
      conversationId: options?.conversationId,
      templateId: options?.templateId,
      scope: options?.scope,
      description: options?.description,
      tags: options?.tags || [],
      regions: options?.regions || [],
      snapshotLink: options?.snapshotLink !== false, // Default: true
    });
  }

  /**
   * List evidence items
   */
  listEvidenceItems(params?: {
    orgId?: string;
    projectId?: string;
    conversationId?: string;
    templateId?: string;
    scope?: 'ORG' | 'PROJECT' | 'TEMPLATE' | 'CONVERSATION';
    sourceType?: EvidenceItem['sourceType'];
    status?: 'DRAFT' | 'APPROVED' | 'DEPRECATED';
    limit?: number;
    offset?: number;
  }): Observable<{ items: EvidenceItem[]; total: number }> {
    let httpParams = new HttpParams();
    if (params?.orgId) httpParams = httpParams.set('orgId', params.orgId);
    if (params?.projectId) httpParams = httpParams.set('projectId', params.projectId);
    if (params?.conversationId) httpParams = httpParams.set('conversationId', params.conversationId);
    if (params?.templateId) httpParams = httpParams.set('templateId', params.templateId);
    if (params?.scope) httpParams = httpParams.set('scope', params.scope);
    if (params?.sourceType) httpParams = httpParams.set('sourceType', params.sourceType);
    if (params?.status) httpParams = httpParams.set('status', params.status);
    if (params?.limit) httpParams = httpParams.set('limit', params.limit.toString());
    if (params?.offset) httpParams = httpParams.set('offset', params.offset.toString());

    return this.http.get<{ items: EvidenceItem[]; total: number }>(`${this.apiBase}/evidence`, { params: httpParams });
  }

  /**
   * Get evidence item by ID
   */
  getEvidenceItem(id: string): Observable<EvidenceItem> {
    return this.http.get<EvidenceItem>(`${this.apiBase}/evidence/${id}`);
  }

  /**
   * Update evidence item
   */
  updateEvidenceItem(
    id: string,
    updates: {
      title?: string;
      description?: string;
      tags?: string[];
      regions?: string[];
      status?: 'DRAFT' | 'APPROVED' | 'DEPRECATED';
      version?: string;
      effectiveFrom?: string;
      effectiveTo?: string;
    }
  ): Observable<EvidenceItem> {
    return this.http.patch<EvidenceItem>(`${this.apiBase}/evidence/${id}`, updates);
  }

  /**
   * Approve evidence item
   */
  approveEvidenceItem(id: string): Observable<EvidenceItem> {
    return this.http.post<EvidenceItem>(`${this.apiBase}/evidence/${id}/approve`, {});
  }

  /**
   * Deprecate evidence item
   */
  deprecateEvidenceItem(id: string): Observable<EvidenceItem> {
    return this.http.post<EvidenceItem>(`${this.apiBase}/evidence/${id}/deprecate`, {});
  }

  /**
   * Resolve evidence set
   */
  resolveEvidenceSet(params: {
    orgId: string;
    projectId?: string;
    conversationId?: string;
    templateId?: string;
    includeOrgEvidence?: boolean;
    includeProjectEvidence?: boolean;
    includeTemplateEvidence?: boolean;
    simulationMode?: boolean;
  }): Observable<EvidenceSet> {
    let httpParams = new HttpParams();
    httpParams = httpParams.set('orgId', params.orgId);
    if (params.projectId) httpParams = httpParams.set('projectId', params.projectId);
    if (params.conversationId) httpParams = httpParams.set('conversationId', params.conversationId);
    if (params.templateId) httpParams = httpParams.set('templateId', params.templateId);
    if (params.includeOrgEvidence !== undefined) httpParams = httpParams.set('includeOrgEvidence', params.includeOrgEvidence.toString());
    if (params.includeProjectEvidence !== undefined) httpParams = httpParams.set('includeProjectEvidence', params.includeProjectEvidence.toString());
    if (params.includeTemplateEvidence !== undefined) httpParams = httpParams.set('includeTemplateEvidence', params.includeTemplateEvidence.toString());
    if (params.simulationMode !== undefined) httpParams = httpParams.set('simulationMode', params.simulationMode.toString());

    return this.http.get<EvidenceSet>(`${this.apiBase}/evidence/resolve`, { params: httpParams });
  }
}

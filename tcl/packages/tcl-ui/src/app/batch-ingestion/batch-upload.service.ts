/**
 * Batch Upload Service
 * 
 * Handles the new batch upload API (POST /api/ingest/batch)
 * with format parsing support (zip, jsonl, csv)
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpProgressEvent } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface BatchUploadConfig {
  template_id?: string;
  mode?: 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT';
  metadata?: Record<string, any>;
  representativeId?: string | null;
}

export interface BatchUploadResponse {
  import_id: string;
  status: 'QUEUED' | 'PROCESSING' | 'DONE' | 'PARTIAL' | 'FAILED';
  counts: {
    total_files: number;
    parsed_transcripts: number;
    failed_items: number;
  };
  items: Array<{
    id: string;
    source_name: string;
    status: string;
    conversation_id?: string;
    evaluation_id?: string;
    error?: string;
    warnings?: any;
  }>;
}

export interface ImportItem {
  id: string;
  import_id: string;
  source_name: string;
  status: 'PARSED' | 'FAILED' | 'QUEUED_FOR_ANALYSIS' | 'ANALYZED';
  conversation_id?: string;
  evaluation_id?: string;
  error?: string;
  warnings?: any;
  created_at: string;
  parsed_at?: string;
  analyzed_at?: string;
}

export interface ImportDetail {
  id: string;
  org_id: string;
  created_by_user_id: string;
  type: 'BATCH_UPLOAD';
  status: 'QUEUED' | 'PROCESSING' | 'DONE' | 'PARTIAL' | 'FAILED';
  template_id?: string;
  config_json: any;
  total_files: number;
  parsed_transcripts: number;
  failed_items: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

@Injectable({
  providedIn: 'root'
})
export class BatchUploadService {
  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(private http: HttpClient) {}

  /**
   * Upload batch files with format parsing
   */
  uploadBatch(
    files: File[],
    config?: BatchUploadConfig
  ): Observable<BatchUploadResponse> {
    const formData = new FormData();
    
    // Add files
    files.forEach(file => {
      formData.append('files', file);
    });
    
    // Add config
    if (config?.template_id) {
      formData.append('template_id', config.template_id);
    }
    if (config?.mode) {
      formData.append('mode', config.mode);
    }
    if (config?.metadata) {
      formData.append('metadata', JSON.stringify(config.metadata));
    }
    if (config?.representativeId) {
      formData.append('representativeId', config.representativeId);
    }

    return this.http.post<BatchUploadResponse>(`${this.apiUrl}/api/ingest/batch`, formData);
  }

  /**
   * Get import details
   */
  getImport(importId: string): Observable<{ import: ImportDetail }> {
    return this.http.get<{ import: ImportDetail }>(`${this.apiUrl}/api/ingest/batch/${importId}`);
  }

  /**
   * Get import items with pagination
   */
  getImportItems(
    importId: string,
    cursor?: string,
    limit?: number
  ): Observable<{
    items: ImportItem[];
    total: number;
    cursor: string;
    has_more: boolean;
  }> {
    const params: any = {};
    if (cursor) params.cursor = cursor;
    if (limit) params.limit = limit.toString();

    return this.http.get<{
      items: ImportItem[];
      total: number;
      cursor: string;
      has_more: boolean;
    }>(`${this.apiUrl}/api/ingest/batch/${importId}/items`, { params });
  }

  /**
   * Get ingestion configuration
   */
  getConfig(): Observable<any> {
    return this.http.get(`${this.apiUrl}/api/config/ingestion`);
  }
}


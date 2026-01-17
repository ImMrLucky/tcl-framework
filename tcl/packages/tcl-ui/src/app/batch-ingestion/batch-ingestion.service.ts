import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface BatchIngestionItem {
  id?: string;
  title: string;
  mode: 'TRANSCRIPT_ONLY' | 'AUDIO_ONLY' | 'AUDIO_PLUS_TRANSCRIPT';
  channel?: string;
  sourceRef?: any;
  status?: string;
  errorMessage?: string;
}

export interface BatchIngestionConfig {
  projectId?: string;
  env?: 'sandbox' | 'production';
  templateId?: string;
  representativeId?: string | null;
}

export interface Batch {
  id: string;
  org_id: string;
  project_id?: string;
  env: string;
  source_type: string;
  status: string;
  config_json: any;
  progress_json: {
    total: number;
    queued: number;
    running: number;
    complete: number;
    failed: number;
  };
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface BatchItem {
  id: string;
  batch_id: string;
  status: string;
  mode: string;
  title: string;
  channel?: string;
  source_ref: any;
  job_id?: string;
  error_message?: string;
  retry_count?: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

@Injectable({
  providedIn: 'root'
})
export class BatchIngestionService {
  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(private http: HttpClient) {}

  // Batch management
  createBatch(sourceType: string, items: BatchIngestionItem[], config?: BatchIngestionConfig): Observable<{ success: boolean; batch: Batch }> {
    return this.http.post<{ success: boolean; batch: Batch }>(`${this.apiUrl}/api/ingest/batch/create`, {
      sourceType,
      items,
      config,
    });
  }

  getBatch(id: string): Observable<{ batch: Batch; items: BatchItem[]; itemCount: number }> {
    return this.http.get<{ batch: Batch; items: BatchItem[]; itemCount: number }>(`${this.apiUrl}/api/ingest/batch/${id}`);
  }

  startBatch(id: string): Observable<{ success: boolean; batch: Batch }> {
    return this.http.post<{ success: boolean; batch: Batch }>(`${this.apiUrl}/api/ingest/batch/${id}/start`, {});
  }

  cancelBatch(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.apiUrl}/api/ingest/batch/${id}/cancel`, {});
  }

  getBatchItems(id: string, limit?: number, offset?: number, status?: string): Observable<{ items: BatchItem[]; total: number; limit: number; offset: number }> {
    const params: any = {};
    if (limit) params.limit = limit.toString();
    if (offset) params.offset = offset.toString();
    if (status) params.status = status;
    return this.http.get<{ items: BatchItem[]; total: number; limit: number; offset: number }>(
      `${this.apiUrl}/api/ingest/batch/${id}/items`,
      { params }
    );
  }

  // Connector operations
  testConnector(type: string, config: any, secrets?: any): Observable<{ success: boolean; error?: string }> {
    return this.http.post<{ success: boolean; error?: string }>(`${this.apiUrl}/api/connectors/${type}/test`, {
      config,
      secrets,
    });
  }

  listConnectorObjects(
    type: string,
    options: {
      path?: string;
      prefix?: string;
      limit?: number;
      offset?: number;
      recursive?: boolean;
      config?: any;
      secrets?: any;
    }
  ): Observable<{ objects: any[]; hasMore: boolean; nextOffset?: number }> {
    const params: any = {};
    if (options.path) params.path = options.path;
    if (options.prefix) params.prefix = options.prefix;
    if (options.limit) params.limit = options.limit.toString();
    if (options.offset) params.offset = options.offset.toString();
    if (options.recursive) params.recursive = 'true';
    if (options.config) params.config = JSON.stringify(options.config);
    if (options.secrets) params.secrets = JSON.stringify(options.secrets);

    return this.http.get<{ objects: any[]; hasMore: boolean; nextOffset?: number }>(
      `${this.apiUrl}/api/connectors/${type}/list`,
      { params }
    );
  }

  createBatchFromSelection(type: string, selection: any[], config?: BatchIngestionConfig): Observable<{ success: boolean; batch: Batch }> {
    return this.http.post<{ success: boolean; batch: Batch }>(`${this.apiUrl}/api/connectors/${type}/batch-from-selection`, {
      selection,
      config,
    });
  }
}


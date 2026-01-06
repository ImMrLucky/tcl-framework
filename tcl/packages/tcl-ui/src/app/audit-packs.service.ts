import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AuditPackRequest {
  evaluationId?: string;
  dateFrom?: string;
  dateTo?: string;
  projectId?: string;
  env?: string;
  includeAllIssues?: boolean;
}

export interface AuditPackResponse {
  packId: string;
  status: 'processing' | 'completed' | 'failed';
  message?: string;
  downloadUrl?: string;
  files?: {
    pdf: string;
    json: string;
    csv: string;
  };
  checksum?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuditPacksService {
  private get apiUrl(): string {
    if (typeof window !== 'undefined') {
      if ((window as any).__TCL_API_URL) {
        return `${(window as any).__TCL_API_URL}`;
      }
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  generatePack(request: AuditPackRequest): Observable<AuditPackResponse> {
    return this.http.post<AuditPackResponse>(`${this.apiUrl}/exports/audit-pack`, request);
  }

  getPackStatus(packId: string): Observable<AuditPackResponse> {
    return this.http.get<AuditPackResponse>(`${this.apiUrl}/exports/audit-pack/${packId}/status`);
  }
}


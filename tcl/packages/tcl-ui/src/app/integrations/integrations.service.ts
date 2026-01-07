import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface IntegrationType {
  type: string;
  name: string;
  description: string;
  comingSoon: boolean;
  connection: IntegrationConnection | null;
}

export interface IntegrationConnection {
  id: string;
  orgId: string;
  type: string;
  status: 'DISCONNECTED' | 'CONNECTED' | 'ERROR';
  config: Record<string, any>;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  comingSoon?: boolean;
}

export interface IntegrationsResponse {
  availableTypes: Array<{
    type: string;
    name: string;
    description: string;
    comingSoon: boolean;
    connection: IntegrationConnection | null;
  }>;
  connections: IntegrationConnection[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  mode: 'SANDBOX' | 'PROD';
  createdAt: string;
  lastUsedAt?: string;
  key?: string; // Only on creation
}

export interface ApiKeysResponse {
  keys: ApiKey[];
}

export interface WebhookEndpoint {
  id: string;
  orgId: string;
  url: string;
  enabled: boolean;
  mode: 'SANDBOX' | 'PROD';
  events: string[];
  createdAt: string;
  updatedAt: string;
  lastDeliveredAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  deliveryCount: number;
  failureCount: number;
  secret?: string; // Only on creation
}

export interface WebhooksResponse {
  webhooks: WebhookEndpoint[];
}

@Injectable({
  providedIn: 'root'
})
export class IntegrationsService {
  private get apiUrl(): string {
    const apiUrl = (window as any).__TCL_API_URL;
    if (apiUrl) {
      return apiUrl;
    }
    return 'https://protectqa.com';
  }

  constructor(private http: HttpClient) {}

  // Integration Connections
  getIntegrations(): Observable<IntegrationsResponse> {
    return this.http.get<IntegrationsResponse>(`${this.apiUrl}/api/integrations`);
  }

  connectIntegration(type: string, config: Record<string, any>): Observable<{ success: boolean; connection: IntegrationConnection }> {
    return this.http.post<{ success: boolean; connection: IntegrationConnection }>(`${this.apiUrl}/api/integrations/connect`, { type, config });
  }

  disconnectIntegration(type: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${this.apiUrl}/api/integrations/disconnect`, { type });
  }

  // API Keys
  getApiKeys(): Observable<ApiKeysResponse> {
    return this.http.get<ApiKeysResponse>(`${this.apiUrl}/api/api-keys`);
  }

  createApiKey(name: string, mode: 'SANDBOX' | 'PROD' = 'SANDBOX'): Observable<ApiKey> {
    return this.http.post<ApiKey>(`${this.apiUrl}/api/api-keys`, { name, mode });
  }

  revokeApiKey(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/api/api-keys/${id}`);
  }

  // Webhooks
  getWebhooks(): Observable<WebhooksResponse> {
    return this.http.get<WebhooksResponse>(`${this.apiUrl}/api/webhooks`);
  }

  createWebhook(url: string, mode: 'SANDBOX' | 'PROD' = 'SANDBOX', events: string[] = ['analysis.completed']): Observable<WebhookEndpoint> {
    return this.http.post<WebhookEndpoint>(`${this.apiUrl}/api/webhooks`, { url, mode, events });
  }

  deleteWebhook(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(`${this.apiUrl}/api/webhooks/${id}`);
  }

  testWebhook(id: string): Observable<{ success: boolean; message: string; payload: any }> {
    return this.http.post<{ success: boolean; message: string; payload: any }>(`${this.apiUrl}/api/webhooks/${id}/test`, {});
  }
}


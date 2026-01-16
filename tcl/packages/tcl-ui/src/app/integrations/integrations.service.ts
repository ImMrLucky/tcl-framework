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

  // Phase 5: Enterprise Integrations (Jira, Webhooks)
  // GET /api/integrations - List all integrations (new API)
  getEnterpriseIntegrations(): Observable<{ integrations: any[] }> {
    return this.http.get<{ integrations: any[] }>(`${this.apiUrl}/api/integrations`);
  }

  // POST /api/integrations - Create integration
  createEnterpriseIntegration(kind: string, config: any, secrets?: any): Observable<{ success: boolean; integration: any }> {
    return this.http.post<{ success: boolean; integration: any }>(`${this.apiUrl}/api/integrations`, {
      kind,
      config,
      secrets,
    });
  }

  // PATCH /api/integrations/:id - Update integration
  updateEnterpriseIntegration(id: string, updates: any): Observable<{ success: boolean; integration: any }> {
    return this.http.patch<{ success: boolean; integration: any }>(`${this.apiUrl}/api/integrations/${id}`, updates);
  }

  // DELETE /api/integrations/:id - Delete integration
  deleteEnterpriseIntegration(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiUrl}/api/integrations/${id}`);
  }

  // Webhooks (Phase 5)
  // POST /api/integrations/webhooks/test - Test webhook
  testWebhookEndpoint(endpointUrl: string, signingSecret?: string): Observable<{ success: boolean; statusCode?: number; responseBody?: string; error?: string }> {
    return this.http.post<{ success: boolean; statusCode?: number; responseBody?: string; error?: string }>(
      `${this.apiUrl}/api/integrations/webhooks/test`,
      { endpointUrl, signingSecret }
    );
  }

  // POST /api/integrations/webhooks/config - Configure webhook
  configureWebhook(endpointUrl: string, enabledEvents: string[], signingSecret?: string, headers?: Record<string, string>): Observable<{ success: boolean; integration: any }> {
    return this.http.post<{ success: boolean; integration: any }>(
      `${this.apiUrl}/api/integrations/webhooks/config`,
      { endpointUrl, enabledEvents, signingSecret, headers }
    );
  }

  // GET /api/integrations/webhooks/deliveries - Get webhook delivery history
  getWebhookDeliveries(limit?: number, offset?: number): Observable<{ deliveries: any[]; total: number; limit: number; offset: number }> {
    const params: any = {};
    if (limit) params.limit = limit.toString();
    if (offset) params.offset = offset.toString();
    return this.http.get<{ deliveries: any[]; total: number; limit: number; offset: number }>(
      `${this.apiUrl}/api/integrations/webhooks/deliveries`,
      { params }
    );
  }

  // Jira (Phase 5)
  // POST /api/integrations/jira/test - Test Jira connection
  testJiraConnection(baseUrl: string, email: string, apiToken: string, projectKey: string): Observable<{ success: boolean; project?: any; error?: string }> {
    return this.http.post<{ success: boolean; project?: any; error?: string }>(
      `${this.apiUrl}/api/integrations/jira/test`,
      { baseUrl, email, apiToken, projectKey }
    );
  }

  // POST /api/integrations/jira/tickets/from-issue - Create Jira ticket from issue
  createJiraTicketFromIssue(issueId: string, evaluationId?: string): Observable<{ success: boolean; ticket: any }> {
    return this.http.post<{ success: boolean; ticket: any }>(
      `${this.apiUrl}/api/integrations/jira/tickets/from-issue`,
      { issueId, evaluationId }
    );
  }

  // POST /api/integrations/jira/tickets/from-issues - Create Jira tickets from multiple issues
  createJiraTicketsFromIssues(issueIds: string[], evaluationId?: string): Observable<{ success: boolean; tickets: any[] }> {
    return this.http.post<{ success: boolean; tickets: any[] }>(
      `${this.apiUrl}/api/integrations/jira/tickets/from-issues`,
      { issueIds, evaluationId }
    );
  }

  // POST /api/integrations/jira/tickets/from-case - Create Jira ticket from case
  createJiraTicketFromCase(caseId: string): Observable<{ success: boolean; ticket: any }> {
    return this.http.post<{ success: boolean; ticket: any }>(
      `${this.apiUrl}/api/integrations/jira/tickets/from-case`,
      { caseId }
    );
  }
}


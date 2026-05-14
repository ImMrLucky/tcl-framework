/**
 * agent-integrations — adapter contracts for external issue trackers.
 *
 * MVP only persists CRUD; sync is deferred. This file pins the shape so we
 * can add adapters without touching the orchestrator later.
 */

export type IntegrationKind =
  | 'jira'
  | 'azure-devops'
  | 'github'
  | 'gitlab'
  | 'linear'
  | 'custom';

export interface ExternalIssueRef {
  kind: IntegrationKind;
  id: string;
  url?: string;
  title?: string;
  status?: string;
}

export interface IntegrationConnection {
  id: string;
  orgId: string;
  teamId: string | null;
  kind: IntegrationKind;
  name: string;
  /** Non-secret config — base url, project key, default labels, etc. */
  config: Record<string, unknown>;
  status: 'NEW' | 'READY' | 'ERROR' | 'DISABLED';
  lastSyncedAt: string | null;
  lastError: string | null;
}

/**
 * Adapter contract — implementations live downstream. The MVP ships a
 * `NoopIntegrationAdapter` that simply echoes `pushTask` back. Real Jira /
 * Azure adapters are deferred per spec §3.
 */
export interface IntegrationAdapter {
  readonly kind: IntegrationKind;

  /** Validate the connection is usable (auth, project exists, etc.). */
  ping(connection: IntegrationConnection, secret: string): Promise<{ ok: boolean; error?: string }>;

  /** Push a local Agent Studio task out to the external tracker. */
  pushTask(
    connection: IntegrationConnection,
    secret: string,
    payload: { title: string; description?: string; labels?: string[]; metadata?: Record<string, unknown> }
  ): Promise<ExternalIssueRef>;

  /** Pull the latest external state for a known issue. */
  fetchIssue(
    connection: IntegrationConnection,
    secret: string,
    externalId: string
  ): Promise<ExternalIssueRef | null>;
}

/**
 * No-op adapter used by the MVP — useful for tests + as a default
 * registration so route handlers can stay symmetric.
 */
export class NoopIntegrationAdapter implements IntegrationAdapter {
  constructor(public readonly kind: IntegrationKind) {}

  async ping(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }

  async pushTask(
    _connection: IntegrationConnection,
    _secret: string,
    payload: { title: string; description?: string; labels?: string[]; metadata?: Record<string, unknown> }
  ): Promise<ExternalIssueRef> {
    return {
      kind: this.kind,
      id: `noop-${Date.now()}`,
      title: payload.title,
      status: 'NEW',
    };
  }

  async fetchIssue(): Promise<ExternalIssueRef | null> {
    return null;
  }
}

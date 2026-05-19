/** HttpClient error body when autonomous tables are not migrated yet. */
export interface AgentStudioListResponse {
  migrationRequired?: boolean;
  migration?: string;
  migrationHint?: string;
}

export function responseNeedsMigration(body: unknown): boolean {
  return !!(body && typeof body === 'object' && (body as AgentStudioListResponse).migrationRequired);
}

export function migrationBannerText(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return 'Autonomous Agent Studio requires database migration 052_agent_studio_autonomous_runs.sql in Supabase.';
  }
  const b = body as AgentStudioListResponse;
  return (
    b.migrationHint ??
    `Run Supabase migration ${b.migration ?? '052_agent_studio_autonomous_runs.sql'}, then reload the API schema.`
  );
}

export function migrationErrorText(err: unknown): string | null {
  const e = err as { status?: number; error?: { code?: string; error?: string; migrationHint?: string } };
  const body = e?.error;
  if (body?.code === 'MIGRATION_REQUIRED') {
    return body.error ?? body.migrationHint ?? migrationBannerText(body);
  }
  if (e?.status === 503 && body?.error) return body.error;
  return null;
}

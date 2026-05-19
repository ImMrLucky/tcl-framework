import type { Response } from 'express';

export const AUTONOMOUS_MIGRATION_FILE = '052_agent_studio_autonomous_runs.sql';

export const AUTONOMOUS_MIGRATION_HINT =
  `Apply supabase/sql/${AUTONOMOUS_MIGRATION_FILE} in the Supabase SQL Editor (or your migration pipeline), then reload the PostgREST schema if prompted.`;

/** True when Supabase/Postgres reports missing autonomous Agent Studio tables. */
export function isAutonomousSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('agent_studio_team_runs') ||
    msg.includes('agent_studio_team_event_log') ||
    msg.includes('agent_studio_local_runners') ||
    msg.includes('agent_studio_local_vendor_refs') ||
    msg.includes('agent_studio_agent_runs')
  );
}

/**
 * GET list endpoints: return 200 + empty lists so the UI does not treat this as a hard failure.
 */
export function respondAutonomousListEmpty(
  res: Response,
  error: { code?: string; message: string },
  emptyPayload: Record<string, unknown>
): boolean {
  if (!isAutonomousSchemaError(error)) return false;
  res.status(200).json({
    migrationRequired: true,
    migration: AUTONOMOUS_MIGRATION_FILE,
    migrationHint: AUTONOMOUS_MIGRATION_HINT,
    ...emptyPayload,
  });
  return true;
}

/** POST/PATCH: 503 when autonomous tables are missing. */
export function respondAutonomousDbError(
  res: Response,
  error: { code?: string; message: string },
  emptyPayload: Record<string, unknown> = {}
): boolean {
  if (!isAutonomousSchemaError(error)) return false;
  res.status(503).json({
    error: `Autonomous Agent Studio is not available yet. ${AUTONOMOUS_MIGRATION_HINT}`,
    code: 'MIGRATION_REQUIRED',
    migration: AUTONOMOUS_MIGRATION_FILE,
    detail: error.message,
    ...emptyPayload,
  });
  return true;
}

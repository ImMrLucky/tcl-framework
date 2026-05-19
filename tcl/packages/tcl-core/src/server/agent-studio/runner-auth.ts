/**
 * Local Agent Runner authentication (execution plane).
 * Tokens are stored hashed; plaintext is returned once at pair time.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { supabaseAdmin } from '../supabase.js';

export function hashRunnerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Hash for 8-char pairing codes (uppercase). */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex');
}

export function generateRunnerAuthToken(): string {
  return randomBytes(32).toString('base64url');
}

export type RunnerAuthContext = {
  runnerId: string;
  orgId: string;
  runner: Record<string, unknown>;
};

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export function extractRunnerId(req: Request): string | null {
  const header = req.headers['x-protectqa-runner-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (req.params['runnerId']) return String(req.params['runnerId']);
  const body = req.body as { runnerId?: string } | undefined;
  if (body?.runnerId) return String(body.runnerId);
  const q = req.query['runnerId'];
  if (typeof q === 'string' && q.trim()) return q.trim();
  return null;
}

export async function requireRunnerAuth(
  req: Request,
  res: Response
): Promise<RunnerAuthContext | null> {
  if (!supabaseAdmin) {
    res.status(503).json({ error: 'Database not configured' });
    return null;
  }

  const runnerId = extractRunnerId(req);
  const token = extractBearerToken(req);
  if (!runnerId || !token) {
    res.status(401).json({
      error: 'Runner authentication required',
      code: 'RUNNER_AUTH_REQUIRED',
      hint: 'Send Authorization: Bearer <runnerAuthToken> and X-ProtectQA-Runner-Id headers.',
    });
    return null;
  }

  const { data: runner, error } = await supabaseAdmin
    .from('agent_studio_local_runners')
    .select('*')
    .eq('id', runnerId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: error.message });
    return null;
  }
  if (!runner) {
    res.status(401).json({ error: 'Runner not found' });
    return null;
  }
  if (runner.status === 'REVOKED') {
    res.status(403).json({ error: 'Runner has been revoked', code: 'RUNNER_REVOKED' });
    return null;
  }

  const storedHash = runner.runner_auth_token_hash as string | null;
  if (!storedHash) {
    res.status(401).json({
      error: 'Runner is not authenticated — pair again to receive a new token',
      code: 'RUNNER_NOT_PAIRED',
    });
    return null;
  }

  const candidate = hashRunnerToken(token);
  try {
    const a = Buffer.from(storedHash, 'hex');
    const b = Buffer.from(candidate, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Invalid runner token', code: 'RUNNER_TOKEN_INVALID' });
      return null;
    }
  } catch {
    res.status(401).json({ error: 'Invalid runner token', code: 'RUNNER_TOKEN_INVALID' });
    return null;
  }

  return {
    runnerId: runner.id as string,
    orgId: runner.org_id as string,
    runner: runner as Record<string, unknown>,
  };
}

/** Ensure a team run / task belongs to the authenticated runner's org. */
export async function assertRunnerOrgAccess(
  res: Response,
  orgId: string,
  resourceOrgId: string
): Promise<boolean> {
  if (orgId !== resourceOrgId) {
    res.status(403).json({ error: 'Resource not in runner org scope' });
    return false;
  }
  return true;
}

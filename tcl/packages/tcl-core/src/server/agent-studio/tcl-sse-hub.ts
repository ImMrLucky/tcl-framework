/**
 * In-process pub/sub for TCL analysis SSE streams (per org + optional team).
 */

import type { Response } from 'express';

export type TclSsePayload = {
  id: string;
  team_id: string;
  status: string;
  report?: unknown;
  error?: string;
  trigger?: string;
  created_at?: string;
};

type Subscriber = {
  res: Response;
  orgId: string;
  teamId?: string;
};

const subscribers = new Set<Subscriber>();

export function subscribeTclStream(
  res: Response,
  orgId: string,
  teamId?: string
): () => void {
  const sub: Subscriber = { res, orgId, teamId };
  subscribers.add(sub);
  return () => subscribers.delete(sub);
}

export function emitTclAnalysisEvent(
  orgId: string,
  teamId: string,
  payload: TclSsePayload
): void {
  const data = JSON.stringify({ ...payload, team_id: teamId });
  for (const sub of subscribers) {
    if (sub.orgId !== orgId) continue;
    if (sub.teamId && sub.teamId !== teamId) continue;
    try {
      sub.res.write(`event: analysis\n`);
      sub.res.write(`data: ${data}\n\n`);
    } catch {
      subscribers.delete(sub);
    }
  }
}

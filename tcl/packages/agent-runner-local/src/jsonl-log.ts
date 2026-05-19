import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_DIR } from './config.js';

export function appendLocalJsonlEvent(teamId: string, event: Record<string, unknown>): void {
  mkdirSync(EVENTS_DIR, { recursive: true });
  const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n';
  appendFileSync(join(EVENTS_DIR, `${teamId}.jsonl`), line, 'utf8');
}

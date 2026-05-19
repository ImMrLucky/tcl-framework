import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

export const RUNNER_HOME = join(homedir(), '.protectqa', 'agent-runner');

export const CONFIG_PATH = join(RUNNER_HOME, 'config.json');
export const VENDORS_PATH = join(RUNNER_HOME, 'vendors.json');
export const EVENTS_DIR = join(RUNNER_HOME, 'team-events');

export interface RunnerConfig {
  apiBaseUrl: string;
  orgId?: string;
  runnerId?: string;
  runnerName?: string;
  pairedAt?: string;
  /** User session token (ProtectQA UI login) — optional, for catalog preview only. */
  authToken?: string;
  /** Runner bearer token — required for job poll/claim and board mutations. */
  runnerAuthToken?: string;
  runnerPublicKey?: string;
  defaultProvider?: string;
  defaultModel?: string;
  pollIntervalMs?: number;
  workspaceRoot?: string;
}

export const DEFAULT_CONFIG: RunnerConfig = {
  apiBaseUrl:
    process.env['TCL_API_URL'] ??
    process.env['PROTECTQA_API_URL'] ??
    'https://api.protectqa.com',
  pollIntervalMs: 5000,
};

export function loadConfig(): RunnerConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as RunnerConfig;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: RunnerConfig): void {
  mkdirSync(RUNNER_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(RUNNER_HOME, 0o700);
  } catch {
    /* windows */
  }
}

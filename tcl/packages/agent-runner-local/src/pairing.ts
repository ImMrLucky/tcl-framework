import { hostname } from 'node:os';
import type { RunnerConfig } from './config.js';
import { saveConfig } from './config.js';
import { pairRunner } from './api-client.js';
import { promptLine } from './prompt.js';

export async function runPairFlow(config: RunnerConfig): Promise<RunnerConfig> {
  const pairingCode = await promptLine('Pairing code (from Agent Studio → Vendors & Runtime)');
  if (!pairingCode) {
    throw new Error('Pairing code is required');
  }
  const apiBaseUrl = await promptLine('ProtectQA API URL', config.apiBaseUrl);
  const deviceLabel = await promptLine('Device label', hostname());
  const next = { ...config, apiBaseUrl };
  const { runner } = await pairRunner(next, pairingCode, deviceLabel);
  const paired: RunnerConfig = {
    ...next,
    runnerId: runner.id,
    runnerName: runner.name,
    pairedAt: new Date().toISOString(),
  };
  saveConfig(paired);
  console.log(`Paired runner ${runner.name} (${runner.id})`);
  return paired;
}

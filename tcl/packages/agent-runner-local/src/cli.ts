#!/usr/bin/env node
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { hostname } from 'node:os';
import {
  CONFIG_PATH,
  DEFAULT_CONFIG,
  RUNNER_HOME,
  VENDORS_PATH,
  loadConfig,
  saveConfig,
} from './config.js';
import { VENDOR_REGISTRY, getVendor } from './vendor-registry.js';
import { listVaultEntries, setVaultApiKey, removeVaultEntry } from './local-key-vault.js';
import { runPairFlow } from './pairing.js';
import { runRunnerLoop } from './runner-loop.js';
import { promptLine, promptSecret } from './prompt.js';
import { registerLocalVendor, requireAuth } from './api-client.js';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'help';
const sub = args[1];

function ensureHome(): void {
  mkdirSync(RUNNER_HOME, { recursive: true });
}

function printHelp(): void {
  console.log(`
@protectqa/agent-runner-local — local execution plane for Agent Studio

Usage:
  agent-runner-local setup              Initialize ~/.protectqa/agent-runner
  agent-runner-local login              Save ProtectQA auth token (for JSONL sync)
  agent-runner-local pair               Pair with Agent Studio (pairing code)
  agent-runner-local add-key <vendor>   Store API key locally (openai, anthropic, …)
  agent-runner-local register-vendors   Push vendor metadata to ProtectQA (no keys)
  agent-runner-local start [--once]     Poll and execute team runs
  agent-runner-local status             Show config + vault summary
  agent-runner-local doctor             Health check
  agent-runner-local vendors            List supported vendors

Environment:
  TCL_API_URL / PROTECTQA_API_URL       API base (default https://api.protectqa.com)
  PROTECTQA_AUTH_TOKEN                  Bearer token (alternative to login)
  PROTECTQA_VAULT_PASSPHRASE            Encrypt vault at rest (recommended)

Docs: https://github.com/protectqa/tcl/tree/main/packages/agent-runner-local
`);
}

async function main(): Promise<void> {
  switch (cmd) {
    case 'setup':
      ensureHome();
      if (!existsSync(CONFIG_PATH)) {
        writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
      }
      if (!existsSync(VENDORS_PATH)) {
        writeFileSync(VENDORS_PATH, JSON.stringify({ vendors: [] }, null, 2));
      }
      console.log('Agent Runner initialized at', RUNNER_HOME);
      console.log('Next: agent-runner-local pair');
      break;

    case 'login': {
      ensureHome();
      const config = loadConfig();
      const token = await promptSecret(
        'Paste Supabase access_token (browser devtools → Application → sb-*-auth-token)'
      );
      if (!token) throw new Error('Token required');
      saveConfig({ ...config, authToken: token });
      console.log('Auth token saved to', CONFIG_PATH);
      break;
    }

    case 'pair': {
      ensureHome();
      let config = loadConfig();
      if (args.includes('--api')) {
        const i = args.indexOf('--api');
        config = { ...config, apiBaseUrl: args[i + 1] ?? config.apiBaseUrl };
      }
      await runPairFlow(config);
      console.log('Optional: agent-runner-local login (sync events to cloud)');
      console.log('Then: agent-runner-local add-key openai');
      break;
    }

    case 'add-key': {
      const vendorKey = sub;
      if (!vendorKey) {
        console.error('Usage: agent-runner-local add-key <vendor>');
        process.exit(1);
      }
      const vendorDef = getVendor(vendorKey);
      if (!vendorDef) {
        console.error('Unknown vendor. Run: agent-runner-local vendors');
        process.exit(1);
      }
      const vendor = vendorDef;
      const label = (await promptLine('Label', 'default')) || 'default';
      let apiKey = '';
      let baseUrl: string | undefined;
      if (vendor.keyStorageMode === 'NONE') {
        if (vendor.requiresBaseUrl) {
          baseUrl = await promptLine(
            'Base URL',
            vendorKey === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1'
          );
        }
        setVaultApiKey(vendorKey, '', { label, baseUrl, defaultModel: vendor.defaultModels[0] });
        console.log(`Configured ${vendorKey} (no API key required).`);
      } else {
        apiKey = await promptSecret(`${vendor.name} API key`);
        if (!apiKey) throw new Error('API key required');
        const entry = setVaultApiKey(vendorKey, apiKey, {
          label,
          defaultModel: vendor.defaultModels[0],
        });
        console.log(`Stored ${vendorKey} key ${entry.keyPreview} in local vault.`);
      }

      const config = loadConfig();
      if (config.runnerId) {
        try {
          const authed = requireAuth(config);
          const entry = listVaultEntries().find((e) => e.provider === vendorKey && e.label === label);
          if (entry) {
            await registerLocalVendor(authed, {
              localRunnerId: config.runnerId,
              provider: vendorKey,
              label,
              localKeyRef: entry.localKeyRef,
              keyPreview: entry.keyPreview,
              supportedModels: vendor.defaultModels,
            });
            console.log('Registered vendor metadata with ProtectQA (no plaintext key sent).');
          }
        } catch {
          console.warn('Skipped cloud register — run `agent-runner-local login` first.');
        }
      }
      break;
    }

    case 'register-vendors': {
      const config = requireAuth(loadConfig());
      if (!config.runnerId) throw new Error('Pair first: agent-runner-local pair');
      for (const entry of listVaultEntries()) {
        const vendor = getVendor(entry.provider);
        await registerLocalVendor(config, {
          localRunnerId: config.runnerId,
          provider: entry.provider,
          label: entry.label,
          localKeyRef: entry.localKeyRef,
          keyPreview: entry.keyPreview,
          supportedModels: vendor?.defaultModels ?? [],
        });
        console.log(`Registered ${entry.provider}/${entry.label}`);
      }
      break;
    }

    case 'start': {
      const once = args.includes('--once');
      const ac = new AbortController();
      process.on('SIGINT', () => {
        console.log('\nStopping…');
        ac.abort();
      });
      await runRunnerLoop({ once, signal: ac.signal });
      break;
    }

    case 'status': {
      const config = loadConfig();
      console.log('Runner home:', RUNNER_HOME);
      console.log('API:', config.apiBaseUrl);
      console.log('Runner ID:', config.runnerId ?? '(not paired)');
      console.log('Paired at:', config.pairedAt ?? '—');
      console.log('Auth token:', config.authToken || process.env['PROTECTQA_AUTH_TOKEN'] ? 'set' : 'missing');
      console.log('Vault entries:');
      for (const e of listVaultEntries()) {
        console.log(`  - ${e.provider}/${e.label} ${e.keyPreview}`);
      }
      if (!listVaultEntries().length) console.log('  (none — run add-key)');
      break;
    }

    case 'doctor':
      console.log('Runner home:', RUNNER_HOME);
      console.log('Config:', existsSync(CONFIG_PATH));
      console.log('Hostname:', hostname());
      console.log('Paired:', !!loadConfig().runnerId);
      console.log('Vault entries:', listVaultEntries().length);
      console.log('Vault encryption:', process.env['PROTECTQA_VAULT_PASSPHRASE'] ? 'enabled' : 'off (set PROTECTQA_VAULT_PASSPHRASE)');
      console.log('Supported vendors:', VENDOR_REGISTRY.map((v) => v.key).join(', '));
      break;

    case 'vendors':
      for (const v of VENDOR_REGISTRY) {
        console.log(`- ${v.key} (${v.name}) keys=${v.keyStorageMode} models=${v.defaultModels.join(', ')}`);
      }
      break;

    case 'remove-key': {
      const provider = sub;
      const label = args[2] ?? 'default';
      if (!provider) {
        console.error('Usage: agent-runner-local remove-key <vendor> [label]');
        process.exit(1);
      }
      if (removeVaultEntry(provider, label)) console.log('Removed.');
      else console.log('Not found.');
      break;
    }

    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

# @protectqa/agent-runner-local

Local **execution plane** for [ProtectQA](https://protectqa.com) Agent Studio. API keys and model calls stay on your machine; ProtectQA stores teams, boards, runs, and audit metadata only.

## Requirements

- Node.js **18+**
- A ProtectQA account with Agent Studio enabled
- Supabase migration `052_agent_studio_autonomous_runs.sql` applied on your org

## Quick start

### 1. In the browser

1. Open **Agent Studio → Vendors & Runtime**
2. Click **Generate pairing code** and copy the code
3. Create a team and use **Launch autonomous team** with an objective

### 2. On your machine

```bash
npx @protectqa/agent-runner-local setup
npx @protectqa/agent-runner-local pair
npx @protectqa/agent-runner-local login
npx @protectqa/agent-runner-local add-key openai
npx @protectqa/agent-runner-local start
```

For a custom API host (self-hosted):

```bash
export TCL_API_URL=https://your-api.example.com
npx @protectqa/agent-runner-local pair
```

### 3. Auth token (`login`)

The runner needs a Bearer token to sync JSONL events to the cloud. After signing in to ProtectQA in the browser:

1. Open DevTools → Application → Local Storage
2. Find `sb-*-auth-token` and copy the `access_token` from the JSON
3. Run `agent-runner-local login` and paste it

Or set `PROTECTQA_AUTH_TOKEN` in your environment.

## Commands

| Command | Description |
|---------|-------------|
| `setup` | Create `~/.protectqa/agent-runner/` |
| `pair` | Pair with a code from the UI |
| `login` | Save auth token for cloud sync |
| `add-key <vendor>` | Store key in local vault (`openai`, `anthropic`, `google-gemini`, `ollama`, …) |
| `register-vendors` | Push metadata (not keys) to ProtectQA |
| `start` | Poll and run team jobs (leave running) |
| `start --once` | Process one poll cycle |
| `status` | Show pairing + vault summary |
| `doctor` | Health check |
| `vendors` | List supported providers |

## Security

- Plaintext API keys are **never** sent to ProtectQA.
- Vendor registration sends only `localKeyRef`, label, and a redacted preview.
- Set `PROTECTQA_VAULT_PASSPHRASE` to encrypt `vault.enc` at rest.
- Revoke a runner from Agent Studio to stop job polling.

## Supported vendors (v0.1)

- **openai** — Chat Completions API
- **anthropic** — Messages API
- **google-gemini** — Generate content API
- **ollama** / **lm-studio** — Local HTTP (no key)

## Publish (maintainers)

```bash
cd packages/agent-runner-local
npm run build
npm publish --access public
```

## License

MIT

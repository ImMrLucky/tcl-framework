# Publishing to npm

All publishable packages use the **`@protectqa` scope** with **`--access=public`**.

## Versions (current)

| Package | Version |
|---------|---------|
| `@protectqa/agent-core` | 0.1.2 |
| `@protectqa/agent-context` | 0.1.1 |
| `@protectqa/agent-orchestrator` | 0.1.1 |
| `@protectqa/agent-workflows` | 0.1.1 |
| `@protectqa/agent-mcp` | 0.1.1 |
| `@protectqa/agent-integrations` | 0.1.1 |
| `@protectqa/agent-model-router` | 0.1.1 |
| `@protectqa/tcl-core` | 0.2.1 |
| `@protectqa/tcl-sdk` | 0.1.1 |
| `@protectqa/agent-runner-local` | 0.1.3 |
| `@protectqa/tcl-browser-runner` | 0.1.1 |
| `@protectqa/tcl-ui` | 0.1.1 |
| `@protectqa/tcl-integrations` | 0.1.1 |
| `@protectqa/tcl-nli-service` | 0.1.1 |
| `@protectqa/tcl-nli-hf` | 0.1.1 |
| `@protectqa/tcl-nli-local` | 0.1.1 |

Bump `"version"` before each publish wave. npm rejects duplicate versions (403).

## Build & publish

```bash
cd /path/to/tcl
npm install
npm run build:publishable
npm run publish:npm
```

Dry run: `DRY_RUN=1 ./scripts/publish-npm.sh`

## Customer install

```bash
npx @protectqa/agent-runner-local@0.1.3 setup
npm install @protectqa/tcl-sdk @protectqa/tcl-core
```

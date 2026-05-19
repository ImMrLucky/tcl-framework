# @protectqa/tcl-sdk

Public TypeScript SDK for the **TCL (Truth & Compliance Layer) engine** — use in apps outside ProtectQA and Agent Studio.

## Install

```bash
npm install @protectqa/tcl-sdk @protectqa/tcl-core
```

In this monorepo:

```bash
npm run build -w packages/tcl-core   # @protectqa/tcl-core
npm run build -w packages/tcl-sdk
```

## Usage

### Core validation (any text)

```ts
import { validate } from '@protectqa/tcl-sdk';

const result = await validate({
  question: 'What did the agent commit to?',
  answer: 'We will ship by Friday with no regressions.',
  options: { repair: false, template: 'generic' },
});

console.log(result.scores, result.report?.suggestions);
```

### Agent Studio adapter (task + output + sources)

```ts
import {
  runStudioTclAnalysis,
  buildArtifactFromAgentRun,
  mapStudioArtifactToValidateInput,
} from '@protectqa/tcl-sdk';

const artifact = buildArtifactFromAgentRun({
  taskTitle: 'Implement login',
  taskDescription: 'OAuth2 only, no passwords in logs',
  output: agentStdout,
  teamId: '…',
  agentId: '…',
  agentRunId: '…',
});

const report = await runStudioTclAnalysis(artifact, {
  trigger: 'MANUAL',
  teamId: artifact.teamId,
});
```

## Publishing

`@protectqa/tcl-sdk` re-exports `tcl-core` — publish both packages together with matching versions. Do not import `tcl-core/src/server/*` from external apps.

## Related

- **ProtectQA / Agent Studio** — TCL Insights UI, IDE TCL tab, live SSE stream
- **tcl-browser-runner** — `npm run dev -w packages/tcl-browser-runner` (port 5174)

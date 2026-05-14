# `agent-model-router`

Provider + routing rule contracts for **Agent Studio**.

Agent Studio is BYOK (bring-your-own-key) and multi-vendor. The router answers
"given an org / team / agent + a use-case (`plan`, `code`, `review`, `chat`,
`tool_use`), which provider, model, and decrypted secret should I use?"

> **Status:** MVP scaffold. Resolution logic + provider SDK glue are deferred;
> CRUD is enforced via `tcl-core/src/server/agent-studio/model-routing.ts`.

See [`docs/specs/agent-studio.md`](../../docs/specs/agent-studio.md).

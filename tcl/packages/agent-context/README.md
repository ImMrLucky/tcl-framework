# `agent-context`

Context store contracts for **Agent Studio**.

Shared team context and per-agent context are first-class in the spec. This
package defines the read / write contract so any storage adapter (Supabase
today, vector store tomorrow) can plug in.

> **Status:** MVP scaffold. Default adapter is in-memory; the production
> Supabase-backed implementation lives in
> `packages/tcl-core/src/server/agent-studio/contexts.ts` for now and will be
> migrated here as the API stabilizes.

See [`docs/specs/agent-studio.md`](../../docs/specs/agent-studio.md).

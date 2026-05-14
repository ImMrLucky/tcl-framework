/**
 * agent-context — contracts for shared (team) and per-agent context stores.
 *
 * Storage is pluggable; this package defines the interface and ships an
 * in-memory adapter useful for tests and local dev. Production storage lives
 * in `tcl-core` for the MVP.
 */

export type ContextScope = 'TEAM' | 'AGENT';

export interface ContextEntry {
  id: string;
  orgId: string;
  scope: ContextScope;
  teamId: string | null;
  agentId: string | null;
  key: string;
  content: string | null;
  data: Record<string, unknown>;
  pinned: boolean;
  source: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextQuery {
  orgId: string;
  scope?: ContextScope;
  teamId?: string;
  agentId?: string;
  key?: string;
  pinnedOnly?: boolean;
  limit?: number;
}

export interface ContextStore {
  list(query: ContextQuery): Promise<ContextEntry[]>;
  get(id: string): Promise<ContextEntry | null>;
  put(entry: Omit<ContextEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContextEntry>;
  update(id: string, patch: Partial<Omit<ContextEntry, 'id' | 'orgId' | 'createdAt'>>): Promise<ContextEntry>;
  delete(id: string): Promise<void>;
}

/**
 * Default in-memory store — useful for tests and local dev. Not for production.
 */
export class InMemoryContextStore implements ContextStore {
  private rows = new Map<string, ContextEntry>();
  private nextId = 1;

  async list(query: ContextQuery): Promise<ContextEntry[]> {
    const all = Array.from(this.rows.values()).filter((r) => r.orgId === query.orgId);
    return all
      .filter((r) => (query.scope ? r.scope === query.scope : true))
      .filter((r) => (query.teamId ? r.teamId === query.teamId : true))
      .filter((r) => (query.agentId ? r.agentId === query.agentId : true))
      .filter((r) => (query.key ? r.key === query.key : true))
      .filter((r) => (query.pinnedOnly ? r.pinned : true))
      .slice(0, query.limit ?? Infinity);
  }

  async get(id: string): Promise<ContextEntry | null> {
    return this.rows.get(id) ?? null;
  }

  async put(entry: Omit<ContextEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContextEntry> {
    const id = `mem_${this.nextId++}`;
    const now = new Date().toISOString();
    const row: ContextEntry = { ...entry, id, createdAt: now, updatedAt: now };
    this.rows.set(id, row);
    return row;
  }

  async update(
    id: string,
    patch: Partial<Omit<ContextEntry, 'id' | 'orgId' | 'createdAt'>>
  ): Promise<ContextEntry> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`ContextEntry not found: ${id}`);
    const updated: ContextEntry = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

/**
 * Per-agent / team / org model + provider key routing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface DbRoutingRule {
  id: string;
  org_id: string;
  team_id: string | null;
  agent_id: string | null;
  scope: string;
  use_case: string;
  provider: string;
  model: string;
  provider_key_id: string | null;
  fallback: unknown;
  params: Record<string, unknown>;
  is_active: boolean;
}

export interface ResolvedModelRouting {
  rule: DbRoutingRule | null;
  provider: string;
  model: string;
  providerKeyId: string | null;
  source: 'AGENT' | 'TEAM' | 'ORG' | 'DEFAULT';
  useCase: string;
}

export const MODEL_USE_CASES = [
  'default',
  'orchestrate',
  'plan',
  'spec',
  'code',
  'review',
  'qa',
  'security',
  'research',
  'summarize',
  'tool_use',
  'context_update',
  'chat',
] as const;

export type ModelUseCase = (typeof MODEL_USE_CASES)[number];

const USE_CASE_SET = new Set<string>(MODEL_USE_CASES);

export function isValidUseCase(useCase: string): boolean {
  return USE_CASE_SET.has(useCase);
}

export function resolveModelRouting(
  rules: DbRoutingRule[],
  input: { orgId: string; teamId: string; agentId: string; useCase: string }
): ResolvedModelRouting {
  const active = rules.filter((r) => r.is_active && r.org_id === input.orgId);
  const candidates = [input.useCase];
  if (input.useCase !== 'default') candidates.push('default');

  for (const uc of candidates) {
    const scoped = active.filter((r) => r.use_case === uc);
    const agent = scoped.find((r) => r.scope === 'AGENT' && r.agent_id === input.agentId);
    if (agent) {
      return {
        rule: agent,
        provider: String(agent.provider).toLowerCase(),
        model: agent.model,
        providerKeyId: agent.provider_key_id,
        source: 'AGENT',
        useCase: uc,
      };
    }
    const team = scoped.find((r) => r.scope === 'TEAM' && r.team_id === input.teamId);
    if (team) {
      return {
        rule: team,
        provider: String(team.provider).toLowerCase(),
        model: team.model,
        providerKeyId: team.provider_key_id,
        source: 'TEAM',
        useCase: uc,
      };
    }
    const org = scoped.find((r) => r.scope === 'ORG');
    if (org) {
      return {
        rule: org,
        provider: String(org.provider).toLowerCase(),
        model: org.model,
        providerKeyId: org.provider_key_id,
        source: 'ORG',
        useCase: uc,
      };
    }
  }

  return {
    rule: null,
    provider: 'openai',
    model: 'gpt-4o-mini',
    providerKeyId: null,
    source: 'DEFAULT',
    useCase: input.useCase,
  };
}

export async function listAgentModelRules(
  supabase: SupabaseClient,
  orgId: string,
  agentId: string
): Promise<DbRoutingRule[]> {
  const { data } = await supabase
    .from('agent_studio_model_routing')
    .select('*')
    .eq('org_id', orgId)
    .eq('agent_id', agentId)
    .eq('scope', 'AGENT')
    .eq('is_active', true)
    .order('use_case', { ascending: true });
  return (data ?? []) as DbRoutingRule[];
}

export async function upsertAgentModelRule(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  agentId: string;
  useCase: string;
  provider: string;
  model: string;
  providerKeyId?: string | null;
}): Promise<DbRoutingRule> {
  const { data: existing } = await opts.supabase
    .from('agent_studio_model_routing')
    .select('id')
    .eq('org_id', opts.orgId)
    .eq('agent_id', opts.agentId)
    .eq('scope', 'AGENT')
    .eq('use_case', opts.useCase)
    .maybeSingle();

  const row = {
    org_id: opts.orgId,
    team_id: opts.teamId,
    agent_id: opts.agentId,
    scope: 'AGENT',
    use_case: opts.useCase,
    provider: opts.provider,
    model: opts.model,
    provider_key_id: opts.providerKeyId ?? null,
    is_active: true,
  };

  if (existing?.id) {
    const { data, error } = await opts.supabase
      .from('agent_studio_model_routing')
      .update(row)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return data as DbRoutingRule;
  }

  const { data, error } = await opts.supabase
    .from('agent_studio_model_routing')
    .insert(row)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as DbRoutingRule;
}

export async function setAgentModelConfig(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  agentId: string;
  isOrchestrator: boolean;
  provider: string;
  model: string;
  providerKeyId?: string | null;
}): Promise<DbRoutingRule[]> {
  const useCases: string[] = opts.isOrchestrator
    ? ['default', 'orchestrate', 'plan', 'review']
    : ['default', 'code', 'chat'];

  const rules: DbRoutingRule[] = [];
  for (const useCase of useCases) {
    rules.push(
      await upsertAgentModelRule({
        supabase: opts.supabase,
        orgId: opts.orgId,
        teamId: opts.teamId,
        agentId: opts.agentId,
        useCase,
        provider: opts.provider,
        model: opts.model,
        providerKeyId: opts.providerKeyId,
      })
    );
  }
  return rules;
}

export const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
  'azure-openai': 'gpt-4o-mini',
  mistral: 'mistral-large-latest',
  groq: 'llama-3.3-70b-versatile',
  ollama: 'llama3.2',
  custom: 'gpt-4o-mini',
};

export function defaultModelForProvider(provider: string): string {
  return DEFAULT_MODEL_BY_PROVIDER[String(provider).toLowerCase()] ?? 'gpt-4o-mini';
}

/** True when this agent already has an AGENT-scoped routing rule with a BYOK key. */
export async function agentHasCustomModelKey(
  supabase: SupabaseClient,
  orgId: string,
  agentId: string
): Promise<boolean> {
  const rules = await listAgentModelRules(supabase, orgId, agentId);
  return rules.some((r) => !!r.provider_key_id);
}

/**
 * Assign provider + model + key to agents that do not yet have a custom BYOK assignment.
 * Org-level keys apply org-wide; team-scoped keys apply only on that team.
 */
export async function applyProviderKeyToAgents(opts: {
  supabase: SupabaseClient;
  orgId: string;
  provider: string;
  providerKeyId: string;
  model?: string;
  teamId?: string | null;
}): Promise<{ assigned: number; skipped: number }> {
  const provider = String(opts.provider).toLowerCase();
  const model = (opts.model?.trim() || defaultModelForProvider(provider)).trim();

  let agentQuery = opts.supabase
    .from('agent_studio_agents')
    .select('id, team_id, is_orchestrator')
    .eq('org_id', opts.orgId);
  if (opts.teamId) {
    agentQuery = agentQuery.eq('team_id', opts.teamId);
  }

  const { data: agents, error } = await agentQuery;
  if (error) throw new Error(error.message);

  let assigned = 0;
  let skipped = 0;

  for (const row of agents ?? []) {
    const agentId = row.id as string;
    const teamId = row.team_id as string;
    const isOrchestrator = !!row.is_orchestrator;

    if (await agentHasCustomModelKey(opts.supabase, opts.orgId, agentId)) {
      skipped += 1;
      continue;
    }

    await setAgentModelConfig({
      supabase: opts.supabase,
      orgId: opts.orgId,
      teamId,
      agentId,
      isOrchestrator,
      provider,
      model,
      providerKeyId: opts.providerKeyId,
    });
    assigned += 1;
  }

  return { assigned, skipped };
}

/** Wire a newly created agent to the org's default provider key when one exists. */
export async function assignDefaultModelFromOrgKeys(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  agentId: string;
  isOrchestrator: boolean;
  preferredProvider?: string;
}): Promise<boolean> {
  if (await agentHasCustomModelKey(opts.supabase, opts.orgId, opts.agentId)) {
    return false;
  }

  const { data: keys, error } = await opts.supabase
    .from('agent_studio_provider_keys')
    .select('id, provider, team_id')
    .eq('org_id', opts.orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error || !keys?.length) return false;

  const prefer = opts.preferredProvider?.toLowerCase();
  const key =
    keys.find((k) => k.team_id === opts.teamId && k.provider === prefer) ??
    keys.find((k) => !k.team_id && k.provider === prefer) ??
    keys.find((k) => k.team_id === opts.teamId) ??
    keys.find((k) => !k.team_id) ??
    keys[0];
  if (!key) return false;

  const provider = String(key.provider).toLowerCase();
  await setAgentModelConfig({
    supabase: opts.supabase,
    orgId: opts.orgId,
    teamId: opts.teamId,
    agentId: opts.agentId,
    isOrchestrator: opts.isOrchestrator,
    provider,
    model: defaultModelForProvider(provider),
    providerKeyId: key.id as string,
  });
  return true;
}

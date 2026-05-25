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

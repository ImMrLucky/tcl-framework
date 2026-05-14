/**
 * agent-model-router — provider + routing rule contracts.
 *
 * The MVP only persists routing rules; provider SDK glue is the next
 * iteration. The router resolves an `(orgId, teamId, agentId, useCase)`
 * triple to a provider + model + decrypted key handle.
 */

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure-openai'
  | 'mistral'
  | 'groq'
  | 'ollama'
  | 'custom';

export type ModelUseCase = 'plan' | 'code' | 'review' | 'spec' | 'chat' | 'tool_use';
export type RoutingScope = 'ORG' | 'TEAM' | 'AGENT';

export interface RoutingRule {
  id: string;
  orgId: string;
  teamId: string | null;
  agentId: string | null;
  scope: RoutingScope;
  useCase: ModelUseCase | string;
  provider: ProviderId | string;
  model: string;
  providerKeyId: string | null;
  fallback: Array<{ provider: ProviderId | string; model: string; providerKeyId: string | null }>;
  params: Record<string, unknown>;
  isActive: boolean;
}

export interface ResolveInput {
  orgId: string;
  teamId: string;
  agentId: string;
  useCase: ModelUseCase | string;
}

export interface ResolvedRoute {
  provider: ProviderId | string;
  model: string;
  providerKeyId: string | null;
  params: Record<string, unknown>;
  /** The rule we picked, for audit / debugging. */
  ruleId: string | null;
  /** Whether we fell back to a default because no rule matched. */
  isDefault: boolean;
}

/**
 * Pure resolution: most-specific rule wins.
 *
 *   AGENT (matching agent + use-case) >
 *   TEAM  (matching team  + use-case) >
 *   ORG   (matching org  + use-case)
 *
 * If nothing matches, returns the supplied `defaultRoute`.
 */
export function resolveRoute(
  rules: RoutingRule[],
  input: ResolveInput,
  defaultRoute: { provider: ProviderId | string; model: string; providerKeyId: string | null; params?: Record<string, unknown> }
): ResolvedRoute {
  const active = rules.filter((r) => r.isActive && r.orgId === input.orgId && r.useCase === input.useCase);

  const agent = active.find((r) => r.scope === 'AGENT' && r.agentId === input.agentId);
  if (agent) {
    return {
      provider: agent.provider,
      model: agent.model,
      providerKeyId: agent.providerKeyId,
      params: agent.params,
      ruleId: agent.id,
      isDefault: false,
    };
  }

  const team = active.find((r) => r.scope === 'TEAM' && r.teamId === input.teamId);
  if (team) {
    return {
      provider: team.provider,
      model: team.model,
      providerKeyId: team.providerKeyId,
      params: team.params,
      ruleId: team.id,
      isDefault: false,
    };
  }

  const org = active.find((r) => r.scope === 'ORG');
  if (org) {
    return {
      provider: org.provider,
      model: org.model,
      providerKeyId: org.providerKeyId,
      params: org.params,
      ruleId: org.id,
      isDefault: false,
    };
  }

  return {
    provider: defaultRoute.provider,
    model: defaultRoute.model,
    providerKeyId: defaultRoute.providerKeyId,
    params: defaultRoute.params ?? {},
    ruleId: null,
    isDefault: true,
  };
}

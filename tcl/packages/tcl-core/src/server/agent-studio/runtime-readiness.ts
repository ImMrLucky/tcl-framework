/**
 * Whether the org can actually call models (local runner vault vs cloud BYOK).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getJarvisAgentId } from './jarvis.js';
import { resolveModelRouting, type DbRoutingRule } from './model-routing.js';
import { isAgentStudioEncryptionConfigured } from './crypto.js';

export type RuntimeExecutionMode = 'none' | 'local' | 'cloud' | 'local_and_cloud';

export interface RuntimeReadiness {
  executionMode: RuntimeExecutionMode;
  /** True when agents can dispatch / autonomous runs can execute. */
  canRunAgents: boolean;
  /** Jarvis board planning uses LLM when Jarvis has routing + BYOK key. */
  planningUsesLlm: boolean;
  /** Server can encrypt cloud BYOK keys (AGENT_STUDIO_ENC_KEY on tcl-core). */
  byokEncryptionConfigured: boolean;
  localRunnersTotal: number;
  localRunnersOnline: number;
  localVendorsReady: number;
  cloudProviderKeys: number;
  routingRulesActive: number;
  hints: string[];
}

const RUNNER_ONLINE_MS = 5 * 60 * 1000;

function runnerIsOnline(row: { status?: string | null; last_seen_at?: string | null }): boolean {
  if (row.status === 'ONLINE') return true;
  if (!row.last_seen_at) return false;
  return Date.now() - new Date(row.last_seen_at).getTime() < RUNNER_ONLINE_MS;
}

async function jarvisCanPlanWithLlm(
  supabase: SupabaseClient,
  orgId: string,
  teamId: string,
  routingRules: DbRoutingRule[]
): Promise<boolean> {
  const jarvisId = await getJarvisAgentId(supabase, orgId, teamId);
  if (!jarvisId) return false;
  const resolved = resolveModelRouting(routingRules, {
    orgId,
    teamId,
    agentId: jarvisId,
    useCase: 'plan',
  });
  return !!resolved.providerKeyId;
}

export async function buildRuntimeReadiness(
  supabase: SupabaseClient,
  orgId: string,
  opts?: { teamId?: string }
): Promise<RuntimeReadiness> {
  const [runnersRes, vendorsRes, keysRes, routingRes] = await Promise.all([
    supabase
      .from('agent_studio_local_runners')
      .select('id, status, last_seen_at')
      .eq('org_id', orgId)
      .neq('status', 'REVOKED'),
    supabase
      .from('agent_studio_local_vendor_refs')
      .select('id, status')
      .eq('org_id', orgId)
      .eq('status', 'READY'),
    supabase
      .from('agent_studio_provider_keys')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_active', true),
    supabase.from('agent_studio_model_routing').select('*').eq('org_id', orgId).eq('is_active', true),
  ]);

  const runners = runnersRes.data ?? [];
  const localRunnersOnline = runners.filter((r) => runnerIsOnline(r)).length;
  const localVendorsReady = vendorsRes.data?.length ?? 0;
  const cloudProviderKeys = keysRes.data?.length ?? 0;
  const routingRules = (routingRes.data ?? []) as DbRoutingRule[];
  const routingRulesActive = routingRules.length;

  const hasLocal = localRunnersOnline > 0 && localVendorsReady > 0;
  const hasCloud = cloudProviderKeys > 0 && routingRulesActive > 0;

  let executionMode: RuntimeExecutionMode = 'none';
  if (hasLocal && hasCloud) executionMode = 'local_and_cloud';
  else if (hasLocal) executionMode = 'local';
  else if (hasCloud) executionMode = 'cloud';

  let planningUsesLlm = false;
  if (opts?.teamId) {
    planningUsesLlm = await jarvisCanPlanWithLlm(supabase, orgId, opts.teamId, routingRules);
  }

  const hints: string[] = [];
  const byokEncryptionConfigured = isAgentStudioEncryptionConfigured();
  hints.push(
    'Each agent gets its own vendor + model via Agents → Model & key. Cloud keys live in Studio Settings → Provider keys.'
  );
  if (!byokEncryptionConfigured) {
    hints.push(
      'Cloud BYOK key save is disabled: set AGENT_STUDIO_ENC_KEY on the tcl-core server (Railway), then redeploy.'
    );
  }
  hints.push(
    planningUsesLlm
      ? 'Plan with Jarvis uses the LLM assigned to Jarvis (Agents → Model & key).'
      : 'Plan with Jarvis falls back to templates until Jarvis has a provider, model, and BYOK key assigned.'
  );

  if (localRunnersOnline === 0) {
    hints.push('No local runner online — pair and start agent-runner-local (Vendors & Runtime).');
  } else if (localVendorsReady === 0) {
    hints.push('Runner is online but no vendor keys registered — run add-key and register-vendors locally.');
  }

  if (cloudProviderKeys === 0) {
    hints.push('No cloud provider keys in Settings — add BYOK keys for server dispatch and Jarvis LLM planning.');
  } else if (routingRulesActive === 0) {
    hints.push('Provider keys exist but no routing rules — assign models on each agent or add org routing in Settings.');
  }

  if (hasLocal || hasCloud) {
    hints.push('Start Working / IDE dispatch can call models once a run is picked up by the runner or cloud dispatch.');
  }

  return {
    executionMode,
    canRunAgents: hasLocal || hasCloud,
    planningUsesLlm,
    byokEncryptionConfigured,
    localRunnersTotal: runners.length,
    localRunnersOnline,
    localVendorsReady,
    cloudProviderKeys,
    routingRulesActive,
    hints,
  };
}

/**
 * Server-side LLM completion using per-agent model routing + BYOK keys.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase.js';
import { bufFromDb } from './bytea.js';
import { decryptString } from './crypto.js';
import { resolveModelRouting, type DbRoutingRule } from './model-routing.js';

async function loadAndDecryptProviderKey(orgId: string, keyId: string): Promise<string> {
  if (!supabaseAdmin) throw new Error('Supabase not configured');
  const { data, error } = await supabaseAdmin
    .from('agent_studio_provider_keys')
    .select('key_ciphertext, key_iv, key_tag, key_alg, org_id')
    .eq('id', keyId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error || !data) throw new Error('Provider key not found');
  return decryptString({
    ciphertext: bufFromDb(data.key_ciphertext),
    iv: bufFromDb(data.key_iv),
    tag: bufFromDb(data.key_tag),
    alg: data.key_alg,
  });
}

async function callOpenAICompatible(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system?: string;
  user: string;
}): Promise<string> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system?.trim()) messages.push({ role: 'system', content: opts.system.trim() });
  messages.push({ role: 'user', content: opts.user });
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, messages, temperature: 0.2 }),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (raw as { error?: { message?: string }; message?: string })?.error?.message ??
      (raw as { message?: string })?.message ??
      res.statusText;
    throw new Error(`OpenAI-compatible API error (${res.status}): ${msg}`);
  }
  const r = raw as { choices?: Array<{ message?: { content?: string }; text?: string }> };
  return String(r?.choices?.[0]?.message?.content ?? r?.choices?.[0]?.text ?? '');
}

async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  system?: string;
  user: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: opts.user }],
  };
  if (opts.system?.trim()) body.system = opts.system.trim();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (raw as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`Anthropic API error (${res.status}): ${msg}`);
  }
  const blocks = (raw as { content?: Array<{ type?: string; text?: string }> })?.content;
  return Array.isArray(blocks)
    ? blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
    : '';
}

export async function completeWithAgentRouting(opts: {
  supabase: SupabaseClient;
  orgId: string;
  teamId: string;
  agentId: string;
  useCase: string;
  system: string;
  user: string;
}): Promise<{ text: string; provider: string; model: string; source: string }> {
  const { data: rules, error } = await opts.supabase
    .from('agent_studio_model_routing')
    .select('*')
    .eq('org_id', opts.orgId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);

  const resolved = resolveModelRouting((rules ?? []) as DbRoutingRule[], {
    orgId: opts.orgId,
    teamId: opts.teamId,
    agentId: opts.agentId,
    useCase: opts.useCase,
  });

  if (!resolved.providerKeyId) {
    throw new Error(
      'NO_PROVIDER_KEY: Assign a provider + model + BYOK key on this agent (Agents → Model & key) or add org routing in Settings.'
    );
  }

  const apiKey = await loadAndDecryptProviderKey(opts.orgId, resolved.providerKeyId);
  let text: string;

  if (resolved.provider === 'anthropic') {
    text = await callAnthropic({
      apiKey,
      model: resolved.model,
      system: opts.system,
      user: opts.user,
    });
  } else if (resolved.provider === 'openai') {
    text = await callOpenAICompatible({
      baseUrl: 'https://api.openai.com/v1',
      apiKey,
      model: resolved.model,
      system: opts.system,
      user: opts.user,
    });
  } else if (resolved.provider === 'groq') {
    text = await callOpenAICompatible({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey,
      model: resolved.model,
      system: opts.system,
      user: opts.user,
    });
  } else if (resolved.provider === 'azure-openai' || resolved.provider === 'custom') {
    const { data: keyRow } = await opts.supabase
      .from('agent_studio_provider_keys')
      .select('metadata')
      .eq('id', resolved.providerKeyId)
      .maybeSingle();
    const meta = (keyRow?.metadata || {}) as Record<string, unknown>;
    const endpoint = String(
      meta.azureEndpoint || meta.endpoint || meta.openaiBaseUrl || meta.baseUrl || ''
    ).replace(/\/$/, '');
    if (!endpoint) throw new Error('Provider key metadata missing base URL / azureEndpoint');
    let base = endpoint;
    if (endpoint.includes('/chat/completions')) {
      base = endpoint.replace(/\/chat\/completions.*$/, '');
    }
    text = await callOpenAICompatible({
      baseUrl: base,
      apiKey,
      model: resolved.model,
      system: opts.system,
      user: opts.user,
    });
  } else {
    throw new Error(`Provider "${resolved.provider}" is not supported for server-side LLM yet`);
  }

  return {
    text,
    provider: resolved.provider,
    model: resolved.model,
    source: resolved.source,
  };
}

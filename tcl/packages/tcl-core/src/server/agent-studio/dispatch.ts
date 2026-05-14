import type express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { readPauseGate } from './pause-gate.js';
import { bufFromDb } from './bytea.js';
import { decryptString } from './crypto.js';
import { logAgentStudioAudit } from './audit.js';

export interface DispatchOrgContext {
  orgId: string;
  userId?: string;
  role?: string;
}

interface DbRoutingRule {
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

function resolveRouting(
  rules: DbRoutingRule[],
  input: { orgId: string; teamId: string; agentId: string; useCase: string }
): DbRoutingRule | null {
  const active = rules.filter(
    (r) => r.is_active && r.org_id === input.orgId && r.use_case === input.useCase
  );
  const agent = active.find((r) => r.scope === 'AGENT' && r.agent_id === input.agentId);
  if (agent) return agent;
  const team = active.find((r) => r.scope === 'TEAM' && r.team_id === input.teamId);
  if (team) return team;
  const org = active.find((r) => r.scope === 'ORG');
  if (org) return org;
  return null;
}

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
  prompt: string;
}): Promise<{ text: string; raw: unknown }> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: 'user', content: opts.prompt }],
      temperature: 0.2,
    }),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (raw as { error?: { message?: string }; message?: string })?.error?.message
      ?? (raw as { message?: string })?.message
      ?? res.statusText;
    throw new Error(`OpenAI-compatible API error (${res.status}): ${msg}`);
  }
  const r = raw as { choices?: Array<{ message?: { content?: string }; text?: string }> };
  const text = r?.choices?.[0]?.message?.content ?? r?.choices?.[0]?.text ?? '';
  return { text: String(text), raw };
}

async function callAnthropic(opts: { apiKey: string; model: string; prompt: string }): Promise<{ text: string; raw: unknown }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: opts.prompt }],
    }),
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (raw as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`Anthropic API error (${res.status}): ${msg}`);
  }
  const blocks = (raw as { content?: Array<{ type?: string; text?: string }> })?.content;
  const text = Array.isArray(blocks)
    ? blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
    : '';
  return { text, raw };
}

/**
 * Pause-aware model dispatch: resolves routing + BYOK key, then calls the
 * vendor HTTP API. Shared pause semantics with mutating Agent Studio routes.
 */
export async function handleAgentStudioDispatch(
  req: express.Request,
  res: express.Response,
  ctx: DispatchOrgContext
): Promise<void> {
  try {
    if (!supabaseAdmin) {
      res.status(503).json({ error: 'Supabase not configured' });
      return;
    }

    const { teamId, agentId, prompt, useCase = 'chat' } = req.body ?? {};
    if (!teamId || !agentId || typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'teamId, agentId, and prompt are required' });
      return;
    }

    const gate = await readPauseGate({ orgId: ctx.orgId, teamId, agentId });
    if (gate.orgPaused || gate.teamPaused || gate.agentPaused) {
      res.status(423).json({
        error: 'PAUSED',
        message: gate.orgPaused
          ? 'Organization-level pause is active.'
          : gate.teamPaused
          ? 'Team is paused.'
          : 'Agent is paused.',
        reasons: gate.reasons,
      });
      return;
    }

    const { data: agentRow } = await supabaseAdmin
      .from('agent_studio_agents')
      .select('id, org_id, team_id')
      .eq('id', agentId)
      .eq('org_id', ctx.orgId)
      .eq('team_id', teamId)
      .maybeSingle();
    if (!agentRow) {
      res.status(404).json({ error: 'Agent not found for this team' });
      return;
    }

    const { data: rules, error: rulesErr } = await supabaseAdmin
      .from('agent_studio_model_routing')
      .select('*')
      .eq('org_id', ctx.orgId)
      .eq('is_active', true);
    if (rulesErr) {
      res.status(500).json({ error: rulesErr.message });
      return;
    }

    const rule = resolveRouting((rules || []) as DbRoutingRule[], {
      orgId: ctx.orgId,
      teamId,
      agentId,
      useCase: String(useCase),
    });

    const defaultModel = 'gpt-4o-mini';
    let provider = 'openai';
    let model = defaultModel;
    let providerKeyId: string | null = null;
    let ruleId: string | null = null;

    if (rule) {
      provider = String(rule.provider).toLowerCase();
      model = rule.model;
      providerKeyId = rule.provider_key_id;
      ruleId = rule.id;
    }

    if (!providerKeyId) {
      res.status(400).json({
        error: 'NO_PROVIDER_KEY',
        message:
          'No active model routing rule with a provider_key_id matches this agent and use case. Add routing in Agent Studio settings.',
        hint: { useCase, teamId, agentId },
      });
      return;
    }

    const apiKey = await loadAndDecryptProviderKey(ctx.orgId, providerKeyId);

    let result: { text: string; raw: unknown };

    if (provider === 'anthropic') {
      result = await callAnthropic({ apiKey, model, prompt: prompt.trim() });
    } else if (provider === 'openai') {
      result = await callOpenAICompatible({
        baseUrl: 'https://api.openai.com/v1',
        apiKey,
        model,
        prompt: prompt.trim(),
      });
    } else if (provider === 'groq') {
      result = await callOpenAICompatible({
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey,
        model,
        prompt: prompt.trim(),
      });
    } else if (provider === 'azure-openai') {
      const { data: keyRow } = await supabaseAdmin
        .from('agent_studio_provider_keys')
        .select('metadata')
        .eq('id', providerKeyId)
        .maybeSingle();
      const meta = (keyRow?.metadata || {}) as Record<string, unknown>;
      const endpoint = String(meta.azureEndpoint || meta.endpoint || '').replace(/\/$/, '');
      if (!endpoint) {
        res.status(400).json({
          error: 'AZURE_ENDPOINT_REQUIRED',
          message:
            'Set metadata.azureEndpoint on the provider key (resource URL prefix before /chat/completions).',
        });
        return;
      }
      let base = endpoint;
      if (endpoint.includes('/chat/completions')) {
        base = endpoint.replace(/\/chat\/completions.*$/, '');
      }
      result = await callOpenAICompatible({
        baseUrl: base,
        apiKey,
        model,
        prompt: prompt.trim(),
      });
    } else if (provider === 'ollama') {
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
      const r = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt.trim() }],
          stream: false,
        }),
      });
      const raw = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Ollama error (${r.status}): ${JSON.stringify(raw)}`);
      const msg = (raw as { message?: { content?: string } })?.message?.content;
      result = { text: String(msg ?? ''), raw };
    } else if (provider === 'custom') {
      const { data: keyRow } = await supabaseAdmin
        .from('agent_studio_provider_keys')
        .select('metadata')
        .eq('id', providerKeyId)
        .maybeSingle();
      const meta = (keyRow?.metadata || {}) as Record<string, unknown>;
      const base = String(meta.openaiBaseUrl || meta.baseUrl || '');
      if (!base) {
        res.status(400).json({
          error: 'CUSTOM_BASE_URL_REQUIRED',
          message: 'Set metadata.openaiBaseUrl on the provider key for custom OpenAI-compatible endpoints.',
        });
        return;
      }
      result = await callOpenAICompatible({
        baseUrl: base,
        apiKey,
        model,
        prompt: prompt.trim(),
      });
    } else {
      res.status(501).json({
        error: 'PROVIDER_NOT_IMPLEMENTED',
        message: `Dispatch for provider "${provider}" is not wired yet. Supported: openai, anthropic, groq, azure-openai (with metadata), ollama, custom (openaiBaseUrl).`,
      });
      return;
    }

    await logAgentStudioAudit({
      orgId: ctx.orgId,
      teamId,
      agentId,
      actorUserId: ctx.userId,
      actorKind: 'USER',
      eventType: 'orchestrator.dispatch',
      resourceType: 'agent_studio_agents',
      resourceId: agentId,
      payload: { useCase, provider, model, ruleId, previewChars: Math.min(200, result.text.length) },
    });

    res.json({
      outcome: 'OK',
      provider,
      model,
      ruleId,
      text: result.text,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Dispatch failed';
    console.error('[agent-studio][dispatch]', err);
    res.status(500).json({ error: message });
  }
}

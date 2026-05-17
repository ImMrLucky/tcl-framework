/**
 * Seed system role/persona templates into Supabase from the embedded catalogue.
 *
 * Idempotent: rows are upserted on the unique (key WHERE org_id IS NULL) constraint.
 * Safe to call concurrently — Supabase handles upserts at the database level.
 *
 * Used so `agent_studio_role_templates` and `agent_studio_persona_templates` are never
 * empty even on a brand-new database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BUILTIN_ROLE_TEMPLATES,
  BUILTIN_PERSONA_TEMPLATES,
} from './generated-agent-catalog.js';

let seedPromise: Promise<{ roles: number; personas: number; error?: string }> | null = null;
let seededAt: number | null = null;
const RESEED_AFTER_MS = 5 * 60 * 1000; // re-seed at most every 5 minutes (best-effort idempotent)

interface BuiltinRole {
  key: string;
  name: string;
  description: string;
  defaultPersona: string;
  defaultCapabilities: string[];
  defaultTools: string[];
  defaultModelUseCases: string[];
  isOrchestrator?: boolean;
}

interface BuiltinPersona {
  key: string;
  name: string;
  description: string;
  personaMarkdown: string;
}

async function doSeed(supabase: SupabaseClient): Promise<{ roles: number; personas: number; error?: string }> {
  const roles = BUILTIN_ROLE_TEMPLATES as unknown as BuiltinRole[];
  const personas = BUILTIN_PERSONA_TEMPLATES as unknown as BuiltinPersona[];

  let roleCount = 0;
  let personaCount = 0;
  let firstError: string | undefined;

  if (Array.isArray(roles) && roles.length > 0) {
    const rows = roles.map((r) => ({
      org_id: null,
      template_pack_id: null,
      key: r.key,
      name: r.name,
      description: r.description ?? null,
      category: r.isOrchestrator ? 'orchestrator' : 'role',
      is_system: true,
      is_active: true,
      default_capabilities: r.defaultCapabilities ?? [],
      default_tools: r.defaultTools ?? [],
      default_model_use_cases: r.defaultModelUseCases ?? [],
      default_review_gates: [],
      role_markdown: r.defaultPersona ?? '',
      default_agent_files: {},
      default_config: { isOrchestrator: !!r.isOrchestrator },
    }));
    const { error, count } = await supabase
      .from('agent_studio_role_templates')
      .upsert(rows, { onConflict: 'key', ignoreDuplicates: false, count: 'exact' });
    if (error) {
      console.warn('[seed-system-templates] roles upsert failed:', error.message);
      firstError = `roles: ${error.message}`;
    } else {
      roleCount = count ?? rows.length;
    }
  }

  if (Array.isArray(personas) && personas.length > 0) {
    const rows = personas.map((p) => ({
      org_id: null,
      template_pack_id: null,
      key: p.key,
      name: p.name,
      description: p.description ?? null,
      category: 'persona',
      is_system: true,
      is_active: true,
      persona_markdown: p.personaMarkdown ?? '',
    }));
    const { error, count } = await supabase
      .from('agent_studio_persona_templates')
      .upsert(rows, { onConflict: 'key', ignoreDuplicates: false, count: 'exact' });
    if (error) {
      console.warn('[seed-system-templates] personas upsert failed:', error.message);
      firstError = firstError ?? `personas: ${error.message}`;
    } else {
      personaCount = count ?? rows.length;
    }
  }

  console.info(`[seed-system-templates] seeded roles=${roleCount} personas=${personaCount}${firstError ? ' (with error: ' + firstError + ')' : ''}`);
  return { roles: roleCount, personas: personaCount, error: firstError };
}

/**
 * Seed once per process; re-checks every RESEED_AFTER_MS so a fresh DB clone
 * won't stay empty until restart.
 */
export async function ensureSystemTemplatesSeeded(
  supabase: SupabaseClient
): Promise<{ roles: number; personas: number; error?: string }> {
  const now = Date.now();
  if (seededAt && now - seededAt < RESEED_AFTER_MS && seedPromise) {
    return seedPromise;
  }
  seedPromise = doSeed(supabase).then((r) => {
    seededAt = Date.now();
    return r;
  });
  return seedPromise;
}

/** Force re-seed (test / admin endpoint). */
export function _resetSeedStateForTests(): void {
  seedPromise = null;
  seededAt = null;
}

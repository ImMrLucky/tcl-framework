/**
 * Evidence Service
 * Handles CRUD operations for evidence items
 * Part of ProtectQA Evidence/Policy System
 */

import { supabaseAdmin } from '../supabase.js';
import type { 
  EvidenceItem, 
  EvidenceScope, 
  EvidenceSourceType, 
  EvidenceStatus,
  EvidenceIndexStatus,
  EvidenceSet,
  EvidenceDiagnostics
} from '../../types/evidence.types.js';

export interface CreateEvidenceItemInput {
  orgId: string;
  projectId?: string;
  conversationId?: string;
  templateId?: string;
  scope: EvidenceScope;
  sourceType: EvidenceSourceType;
  title: string;
  description?: string;
  tags?: string[];
  regions?: string[];
  storageKind: 'FILE' | 'LINK';
  // File fields
  file?: {
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storagePath: string;
    originalName: string;
  };
  // Link fields
  link?: {
    url: string;
    fetchedAt?: string;
    sha256?: string;
    snapshotStoragePath?: string;
  };
  status?: EvidenceStatus;
  version?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  createdBy: string;
  // Authority & Override (ORG scope only)
  authorityLevel?: 'BINDING' | 'INFORMATIONAL';
  overridePolicy?: 'LOCKED' | 'ALLOW_SUPPLEMENT' | 'ALLOW_OVERRIDE';
  ruleMeta?: {
    mustSay?: string[];
    mustNotSay?: string[];
    requiredDisclosures?: string[];
    forbiddenClaims?: string[];
    jurisdiction?: string;
    regexRules?: Array<{ pattern: string; flags?: string; description?: string }>;
  };
}

export interface UpdateEvidenceItemInput {
  title?: string;
  description?: string;
  tags?: string[];
  regions?: string[];
  status?: EvidenceStatus;
  version?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  // Authority & Override (ORG scope only, admin/owner only)
  authorityLevel?: 'BINDING' | 'INFORMATIONAL';
  overridePolicy?: 'LOCKED' | 'ALLOW_SUPPLEMENT' | 'ALLOW_OVERRIDE';
  ruleMeta?: {
    mustSay?: string[];
    mustNotSay?: string[];
    requiredDisclosures?: string[];
    forbiddenClaims?: string[];
    jurisdiction?: string;
    regexRules?: Array<{ pattern: string; flags?: string; description?: string }>;
  };
}

/**
 * Create a new evidence item
 */
export async function createEvidenceItem(input: CreateEvidenceItemInput): Promise<EvidenceItem> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const insertData: any = {
    org_id: input.orgId,
    project_id: input.projectId || null,
    conversation_id: input.conversationId || null,
    template_id: input.templateId || null,
    scope: input.scope,
    source_type: input.sourceType,
    title: input.title,
    description: input.description || null,
    tags: input.tags || [],
    regions: input.regions || [],
    storage_kind: input.storageKind,
    status: input.status || 'DRAFT',
    version: input.version || '1.0.0',
    effective_from: input.effectiveFrom || null,
    effective_to: input.effectiveTo || null,
    created_by: input.createdBy,
    index_status: 'PENDING',
    rule_meta: input.ruleMeta || {},
    // Authority & Override (only for ORG scope)
    authority_level: input.scope === 'ORG' ? (input.authorityLevel || 'INFORMATIONAL') : null,
    override_policy: input.scope === 'ORG' ? (input.overridePolicy || (input.authorityLevel === 'BINDING' ? 'LOCKED' : 'ALLOW_SUPPLEMENT')) : null,
  };

  // Add file fields if storageKind is FILE
  if (input.storageKind === 'FILE' && input.file) {
    insertData.file_mime_type = input.file.mimeType;
    insertData.file_size_bytes = input.file.sizeBytes;
    insertData.file_sha256 = input.file.sha256;
    insertData.file_storage_path = input.file.storagePath;
    insertData.file_original_name = input.file.originalName;
  }

  // Add link fields if storageKind is LINK
  if (input.storageKind === 'LINK' && input.link) {
    insertData.link_url = input.link.url;
    insertData.link_fetched_at = input.link.fetchedAt || null;
    insertData.link_sha256 = input.link.sha256 || null;
    insertData.link_snapshot_storage_path = input.link.snapshotStoragePath || null;
  }

  const { data, error } = await supabaseAdmin
    .from('evidence_items')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create evidence item: ${error.message}`);
  }

  return mapDbRowToEvidenceItem(data);
}

/**
 * Get evidence item by ID
 */
export async function getEvidenceItemById(
  evidenceItemId: string,
  orgId: string
): Promise<EvidenceItem | null> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('evidence_items')
    .select('*')
    .eq('id', evidenceItemId)
    .eq('org_id', orgId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to get evidence item: ${error.message}`);
  }

  return data ? mapDbRowToEvidenceItem(data) : null;
}

/**
 * List evidence items for an org/project/template/conversation
 */
export interface ListEvidenceItemsOptions {
  orgId: string;
  projectId?: string;
  conversationId?: string;
  templateId?: string;
  scope?: EvidenceScope;
  sourceType?: EvidenceSourceType;
  status?: EvidenceStatus;
  indexStatus?: EvidenceIndexStatus;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export async function listEvidenceItems(
  options: ListEvidenceItemsOptions
): Promise<{ items: EvidenceItem[]; total: number }> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  let query = supabaseAdmin
    .from('evidence_items')
    .select('*', { count: 'exact' })
    .eq('org_id', options.orgId);

  if (options.projectId) {
    query = query.eq('project_id', options.projectId);
  }
  if (options.conversationId) {
    query = query.eq('conversation_id', options.conversationId);
  }
  if (options.templateId) {
    query = query.eq('template_id', options.templateId);
  }
  if (options.scope) {
    query = query.eq('scope', options.scope);
  }
  if (options.sourceType) {
    query = query.eq('source_type', options.sourceType);
  }
  if (options.status) {
    query = query.eq('status', options.status);
  }
  if (options.indexStatus) {
    query = query.eq('index_status', options.indexStatus);
  }
  if (options.tags && options.tags.length > 0) {
    query = query.contains('tags', options.tags);
  }

  query = query.order('created_at', { ascending: false });

  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list evidence items: ${error.message}`);
  }

  return {
    items: (data || []).map(mapDbRowToEvidenceItem),
    total: count || 0,
  };
}

/**
 * Update evidence item
 */
export async function updateEvidenceItem(
  evidenceItemId: string,
  orgId: string,
  input: UpdateEvidenceItemInput,
  updatedBy?: string
): Promise<EvidenceItem> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  // First, get the current evidence item to check scope
  const { data: currentItem } = await supabaseAdmin
    .from('evidence_items')
    .select('scope')
    .eq('id', evidenceItemId)
    .eq('org_id', orgId)
    .single();

  if (!currentItem) {
    throw new Error('Evidence item not found');
  }

  const updateData: any = {};

  if (input.title !== undefined) updateData.title = input.title;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.tags !== undefined) updateData.tags = input.tags;
  if (input.regions !== undefined) updateData.regions = input.regions;
  if (input.status !== undefined) updateData.status = input.status;
  if (input.version !== undefined) updateData.version = input.version;
  if (input.effectiveFrom !== undefined) updateData.effective_from = input.effectiveFrom || null;
  if (input.effectiveTo !== undefined) updateData.effective_to = input.effectiveTo || null;
  if (input.ruleMeta !== undefined) updateData.rule_meta = input.ruleMeta;
  
  // Authority & Override (only for ORG scope)
  if (currentItem.scope === 'ORG') {
    if (input.authorityLevel !== undefined) {
      updateData.authority_level = input.authorityLevel;
    }
    if (input.overridePolicy !== undefined) {
      updateData.override_policy = input.overridePolicy;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('evidence_items')
    .update(updateData)
    .eq('id', evidenceItemId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update evidence item: ${error.message}`);
  }

  return mapDbRowToEvidenceItem(data);
}

/**
 * Approve evidence item
 */
export async function approveEvidenceItem(
  evidenceItemId: string,
  orgId: string,
  approvedBy: string
): Promise<EvidenceItem> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('evidence_items')
    .update({
      status: 'APPROVED',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
    })
    .eq('id', evidenceItemId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to approve evidence item: ${error.message}`);
  }

  // Log approval in audit table (fire and forget - don't block on this)
  try {
    await supabaseAdmin
      .from('evidence_approvals')
      .insert({
        evidence_item_id: evidenceItemId,
        org_id: orgId,
        action: 'APPROVED',
        actor_user_id: approvedBy,
      });
  } catch (err: any) {
    console.warn('Failed to log approval in evidence_approvals:', err);
  }
  
  // Log audit event (fire and forget - don't block on this)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        org_id: data.org_id,
        actor_user_id: approvedBy,
        action: 'evidence.approve',
        target_type: 'evidence_item',
        target_id: evidenceItemId,
        meta: { evidenceItemId },
      });
  } catch (err: any) {
    console.warn('Failed to log approval audit:', err);
  }

  return mapDbRowToEvidenceItem(data);
}

/**
 * Deprecate evidence item
 */
export async function deprecateEvidenceItem(
  evidenceItemId: string,
  orgId: string,
  deprecatedBy: string,
  notes?: string
): Promise<EvidenceItem> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('evidence_items')
    .update({
      status: 'DEPRECATED',
    })
    .eq('id', evidenceItemId)
    .eq('org_id', orgId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to deprecate evidence item: ${error.message}`);
  }

  // Log deprecation in audit table (fire and forget - don't block on this)
  try {
    await supabaseAdmin
      .from('evidence_approvals')
      .insert({
        evidence_item_id: evidenceItemId,
        org_id: orgId,
        action: 'DEPRECATED',
        actor_user_id: deprecatedBy,
        notes: notes || null,
      });
  } catch (err: any) {
    console.warn('Failed to log deprecation in evidence_approvals:', err);
  }
  
  // Log audit event (fire and forget - don't block on this)
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        org_id: data.org_id,
        actor_user_id: deprecatedBy,
        action: 'evidence.deprecate',
        target_type: 'evidence_item',
        target_id: evidenceItemId,
        meta: { evidenceItemId, notes: notes || null },
      });
  } catch (err: any) {
    console.warn('Failed to log deprecation audit:', err);
  }

  return mapDbRowToEvidenceItem(data);
}

/**
 * Update indexing status
 */
export async function updateIndexingStatus(
  evidenceItemId: string,
  status: EvidenceIndexStatus,
  chunkCount?: number,
  embeddingModel?: string,
  indexError?: string
): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const updateData: any = {
    index_status: status,
  };

  if (chunkCount !== undefined) updateData.chunk_count = chunkCount;
  if (embeddingModel !== undefined) updateData.embedding_model = embeddingModel;
  if (indexError !== undefined) updateData.index_error = indexError;

  const { error } = await supabaseAdmin
    .from('evidence_items')
    .update(updateData)
    .eq('id', evidenceItemId);

  if (error) {
    throw new Error(`Failed to update indexing status: ${error.message}`);
  }
}

/**
 * Resolve evidence set for an evaluation run
 * Uses the database function resolve_evidence_set()
 */
export async function resolveEvidenceSet(
  orgId: string,
  projectId?: string,
  templateId?: string,
  conversationId?: string,
  simulationMode: boolean = false,
  includeOrg: boolean = true,
  includeProject: boolean = true,
  includeTemplate: boolean = true
): Promise<EvidenceSet> {
  if (!supabaseAdmin) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin.rpc('resolve_evidence_set', {
    p_org_id: orgId,
    p_project_id: projectId || null,
    p_template_id: templateId || null,
    p_conversation_id: conversationId || null,
    p_simulation_mode: simulationMode,
    p_include_org: includeOrg,
    p_include_project: includeProject,
    p_include_template: includeTemplate,
  });

  if (error) {
    throw new Error(`Failed to resolve evidence set: ${error.message}`);
  }

  // The RPC function returns a JSONB object with the evidence set structure
  return data as EvidenceSet;
}

/**
 * Map database row to EvidenceItem type
 */
function mapDbRowToEvidenceItem(row: any): EvidenceItem {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id || undefined,
    conversationId: row.conversation_id || undefined,
    templateId: row.template_id || undefined,
    scope: row.scope,
    sourceType: row.source_type,
    title: row.title,
    description: row.description || undefined,
    tags: row.tags || [],
    regions: row.regions || [],
    storageKind: row.storage_kind,
    file: row.storage_kind === 'FILE' && row.file_sha256 ? {
      mimeType: row.file_mime_type || '',
      sizeBytes: row.file_size_bytes || 0,
      sha256: row.file_sha256,
      storagePath: row.file_storage_path || '',
      originalName: row.file_original_name || '',
    } : undefined,
    link: row.storage_kind === 'LINK' && row.link_url ? {
      url: row.link_url,
      fetchedAt: row.link_fetched_at || undefined,
      sha256: row.link_sha256 || undefined,
      snapshotStoragePath: row.link_snapshot_storage_path || undefined,
    } : undefined,
    status: row.status,
    version: row.version,
    effectiveFrom: row.effective_from || undefined,
    effectiveTo: row.effective_to || undefined,
    authorityLevel: row.authority_level || undefined,
    overridePolicy: row.override_policy || undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedBy: row.approved_by || undefined,
    approvedAt: row.approved_at || undefined,
    indexStatus: row.index_status,
    chunkCount: row.chunk_count || undefined,
    embeddingModel: row.embedding_model || undefined,
    indexError: row.index_error || undefined,
    ruleMeta: row.rule_meta || undefined,
  };
}


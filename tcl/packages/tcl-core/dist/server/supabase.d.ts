import { SupabaseClient } from '@supabase/supabase-js';
export declare const supabaseAdmin: SupabaseClient<any, "public", "public", any, any> | null;
export declare const supabaseAnon: SupabaseClient<any, "public", "public", any, any> | null;
/**
 * Hash an API key for storage
 */
export declare function hashApiKey(key: string): string;
/**
 * Generate a new API key
 */
export declare function generateApiKey(): {
    key: string;
    prefix: string;
    hash: string;
};
/**
 * Verify an API key and return org_id + scopes (legacy - use verifyApiKeyExtended)
 */
export declare function verifyApiKey(key: string): Promise<{
    orgId: string;
    scopes: string[];
} | null>;
/**
 * Verify API key and return org/project/env info (extended)
 */
export declare function verifyApiKeyExtended(key: string): Promise<{
    orgId: string;
    projectId: string;
    env: string;
    scopes: string[];
} | null>;
/**
 * Get or create user profile - RELIABLE VERSION
 * Uses database function (RPC) which runs in database context and handles timing properly
 */
export declare function ensureProfile(userId: string, email?: string): Promise<boolean>;
/**
 * Provision user: create profile + default org + default project if needed
 */
export declare function provisionUser(userId: string, email: string): Promise<{
    orgId: string;
    projectId: string;
} | null>;
/**
 * Get user's role in an organization
 */
export declare function getUserRole(userId: string, orgId: string): Promise<string | null>;
/**
 * Check if user has a specific permission in an org
 */
export declare function checkUserPermission(userId: string, orgId: string, permission: 'view' | 'review' | 'configure' | 'export' | 'billing' | 'manage_members' | 'manage_integrations'): Promise<boolean>;
/**
 * Get user's organizations
 */
export declare function getUserOrgs(userId: string): Promise<Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
}>>;
/**
 * Get projects for an org
 */
export declare function getOrgProjects(orgId: string): Promise<Array<{
    id: string;
    name: string;
    slug: string;
    isDefault: boolean;
}>>;
/**
 * Get project environments
 */
export declare function getProjectEnvs(projectId: string): Promise<Array<{
    id: string;
    env: string;
    limits: any;
}>>;
/**
 * Track usage for an evaluation or conversation
 */
export declare function trackUsage(orgId: string, projectId: string, env: string, type: 'evaluation' | 'conversation' | 'transcription'): Promise<void>;
/**
 * Log audit event
 */
export declare function logAudit(params: {
    orgId?: string;
    actorUserId?: string;
    actorApiKeyId?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    meta?: Record<string, any>;
}): Promise<void>;

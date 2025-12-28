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
 * Verify an API key and return org_id + scopes
 */
export declare function verifyApiKey(key: string): Promise<{
    orgId: string;
    scopes: string[];
} | null>;
/**
 * Get or create user profile
 */
export declare function ensureProfile(userId: string, email?: string): Promise<void>;
/**
 * Provision user: create profile + default org if needed
 */
export declare function provisionUser(userId: string, email: string): Promise<{
    orgId: string;
} | null>;
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

/**
 * Supabase client for Integration Service
 * Separate from TCL Core to maintain decoupling
 */
import { SupabaseClient } from '@supabase/supabase-js';
export declare const supabaseAdmin: SupabaseClient;
/**
 * Get organization context from API key or user session
 */
export declare function getOrgContext(apiKey?: string, userId?: string): Promise<{
    orgId: string;
    projectId: string;
    env: 'sandbox' | 'production';
} | null>;

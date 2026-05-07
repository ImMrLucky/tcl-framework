import type { SupabaseClient } from '@supabase/supabase-js';
export interface JiraConfig {
    base_url: string;
    project_key: string;
    issue_type: string;
    severity_priority_map?: Record<string, string>;
    labels?: string[];
    components?: string[];
}
export interface JiraTicket {
    key: string;
    id: string;
    self: string;
}
/**
 * Get Jira integration for an org
 */
export declare function getJiraIntegration(orgId: string, supabase: SupabaseClient): Promise<any | null>;
/**
 * Get Jira credentials
 */
export declare function getJiraCredentials(orgId: string, supabase: SupabaseClient): Promise<{
    email: string;
    apiToken: string;
} | null>;
/**
 * Create Jira ticket
 */
export declare function createJiraTicket(config: JiraConfig, credentials: {
    email: string;
    apiToken: string;
}, issue: any, evaluationLink?: string): Promise<JiraTicket>;
/**
 * Create multiple Jira tickets (bulk)
 */
export declare function createJiraTicketsBulk(config: JiraConfig, credentials: {
    email: string;
    apiToken: string;
}, issues: any[], evaluationLink?: string): Promise<JiraTicket[]>;

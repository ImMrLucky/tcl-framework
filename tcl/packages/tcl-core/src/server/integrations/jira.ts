import { supabaseAdmin } from '../supabase.js';
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
export async function getJiraIntegration(
  orgId: string,
  supabase: SupabaseClient
): Promise<any | null> {
  const { data, error } = await supabase
    .from('enterprise_integrations')
    .select('*')
    .eq('org_id', orgId)
    .eq('kind', 'JIRA')
    .eq('status', 'ACTIVE')
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch Jira integration:', error);
    return null;
  }

  return data;
}

/**
 * Get Jira credentials
 */
export async function getJiraCredentials(
  orgId: string,
  supabase: SupabaseClient
): Promise<{ email: string; apiToken: string } | null> {
  const { data: emailData, error: emailError } = await supabase
    .from('integration_secrets')
    .select('ciphertext')
    .eq('org_id', orgId)
    .eq('integration_kind', 'JIRA')
    .eq('key', 'jira_email')
    .maybeSingle();

  const { data: tokenData, error: tokenError } = await supabase
    .from('integration_secrets')
    .select('ciphertext')
    .eq('org_id', orgId)
    .eq('integration_kind', 'JIRA')
    .eq('key', 'jira_api_token')
    .maybeSingle();

  if (emailError || tokenError || !emailData || !tokenData) {
    return null;
  }

  // TODO: Decrypt ciphertext in production
  return {
    email: emailData.ciphertext,
    apiToken: tokenData.ciphertext,
  };
}

/**
 * Create Jira ticket
 */
export async function createJiraTicket(
  config: JiraConfig,
  credentials: { email: string; apiToken: string },
  issue: any,
  evaluationLink?: string
): Promise<JiraTicket> {
  const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64');
  
  // Build issue summary
  const summary = `[ProtectQA] ${issue.decision?.disposition || 'OPEN'} ${issue.severity || 'MEDIUM'} ${issue.type || 'Issue'} - ${(issue.what?.issueSummary || '').substring(0, 100)}`;

  // Build description
  const description = [
    `*ProtectQA Issue Detected*`,
    ``,
    `*Evaluation Link:* ${evaluationLink || 'N/A'}`,
    `*Issue ID:* ${issue.issueId || 'N/A'}`,
    `*Type:* ${issue.type || 'N/A'}`,
    `*Category:* ${issue.category || 'N/A'}`,
    `*Severity:* ${issue.severity || 'N/A'}`,
    `*Risk Score:* ${((issue.score ?? (issue.riskScore ?? 0) * 100)).toFixed(0)}%`,
    ``,
    `*Summary:*`,
    issue.what?.issueSummary || 'N/A',
    ``,
    `*Detail:*`,
    issue.what?.issueDetail || 'N/A',
    ``,
  ];

  // Add transcript excerpts if available
  if (issue.evidence?.refs && issue.evidence.refs.length > 0) {
    description.push(`*Evidence Quotes:*`);
    issue.evidence.refs.slice(0, 3).forEach((ref: any) => {
      description.push(`{quote}${ref.quote}{quote}`);
      if (ref.turnIndex !== undefined) {
        description.push(`(Turn ${ref.turnIndex + 1})`);
      }
    });
    description.push(``);
  }

  // Add decision info if available
  if (issue.decision) {
    description.push(`*Decision:* ${issue.decision.disposition}`);
    if (issue.decision.notes) {
      description.push(`*Notes:* ${issue.decision.notes}`);
    }
  }

  // Add signoffs if available
  if (issue.signoffs && issue.signoffs.length > 0) {
    description.push(`*Signoffs:*`);
    issue.signoffs.forEach((signoff: any) => {
      description.push(`- ${signoff.role}: Signed at ${signoff.signedAt}`);
    });
  }

  // Build Jira issue payload
  const jiraIssue: any = {
    fields: {
      project: {
        key: config.project_key,
      },
      summary,
      description: description.join('\n'),
      issuetype: {
        name: config.issue_type,
      },
    },
  };

  // Add priority mapping if configured
  if (config.severity_priority_map && issue.severity) {
    const priority = config.severity_priority_map[issue.severity];
    if (priority) {
      jiraIssue.fields.priority = { name: priority };
    }
  }

  // Add labels if configured
  if (config.labels && config.labels.length > 0) {
    jiraIssue.fields.labels = config.labels;
  }

  // Add components if configured
  if (config.components && config.components.length > 0) {
    jiraIssue.fields.components = config.components.map((name: string) => ({ name }));
  }

  // Make API request
  const response = await fetch(`${config.base_url}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(jiraIssue),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Jira API error: ${response.status} ${errorBody.substring(0, 200)}`);
  }

  const ticket = await response.json();
  return {
    key: ticket.key,
    id: ticket.id,
    self: ticket.self,
  };
}

/**
 * Create multiple Jira tickets (bulk)
 */
export async function createJiraTicketsBulk(
  config: JiraConfig,
  credentials: { email: string; apiToken: string },
  issues: any[],
  evaluationLink?: string
): Promise<JiraTicket[]> {
  const tickets: JiraTicket[] = [];
  
  for (const issue of issues) {
    try {
      const ticket = await createJiraTicket(config, credentials, issue, evaluationLink);
      tickets.push(ticket);
    } catch (error: any) {
      console.error(`Failed to create Jira ticket for issue ${issue.issueId}:`, error);
      // Continue with next issue
    }
  }
  
  return tickets;
}


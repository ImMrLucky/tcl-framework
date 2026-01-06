/**
 * Issue Queue Models
 * Based on API response structure from /api/issues/queue
 */

export interface IssuePatternRow {
  patternKey: string;
  title: string;
  summary: string;
  category: string;
  type: string;
  impact?: 'low' | 'medium' | 'high';
  severity: 'low' | 'medium' | 'high' | 'critical';
  severityDisplay: 'low' | 'medium' | 'high' | 'critical';
  occurrences: number;
  uniqueAgents?: number;
  uniqueCustomers?: number;
  verificationCounts: {
    EXTERNAL_VERIFIED: number;
    TRANSCRIPT_ONLY: number;
    NONE: number;
  };
  lastSeenAt: string;
  firstSeenAt: string;
  trend: {
    direction: 'up' | 'down' | 'flat';
    pctChange: number;
    window: string;
  };
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
  assignee?: string | null;
  priorityScore: number;
  avgRiskScore: number;
  maxRiskScore: number;
}

export interface IssueQueueResponse {
  rows: IssuePatternRow[];
  total: number;
  page: number;
  pageSize: number;
  diagnostics?: { mode?: string; warnings?: string[] };
}

export interface IssuePatternOccurrence {
  evaluationId: string;
  conversationId: string;
  occurredAt: string;
  riskScore: number;
  score?: number;
  severityDisplay: 'low' | 'medium' | 'high' | 'critical';
  verificationLevel: 'EXTERNAL_VERIFIED' | 'TRANSCRIPT_ONLY' | 'NONE';
  who: {
    speaker: string;
    turnIndex?: number;
  };
  what: {
    primaryClaimId: string;
    issueSummary: string;
    claimText?: string;
  };
  evidencePreview: Array<{
    sourceType: string;
    quote: string;
    turnIndex?: number;
  }>;
  tracePreview?: {
    contradictionPairs?: Array<{
      claimA: string;
      claimB: string;
      weight: number;
    }>;
  };
}

export interface IssuePatternDetail {
  patternKey: string;
  title: string;
  summary: string;
  recommendedActions?: string[];
  occurrences: number;
  verificationCounts: IssuePatternRow['verificationCounts'];
  status: IssuePatternRow['status'];
  assignee?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrencesList: IssuePatternOccurrence[];
  traceability?: {
    topEdges: Array<{
      kind: string;
      claimA: string;
      claimB?: string;
      weight: number;
    }>;
  };
  scoring?: any;
}

export interface QueueFilters {
  from?: string;
  to?: string;
  severity?: string;
  verification?: string;
  status?: string;
  type?: string;
  category?: string;
  assignee?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  hideResolved?: boolean;
}


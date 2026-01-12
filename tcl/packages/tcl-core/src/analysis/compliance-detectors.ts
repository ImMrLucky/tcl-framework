/**
 * Compliance Detectors Module
 * 
 * D: Rule-based detectors for enterprise-credible compliance issues
 * These detectors emit issues in category="compliance" with severity floor = high
 * 
 * Examples:
 * - PCI: "store CVV", "save CVV", or capturing CVV in transcript
 * - Recording consent: agent denies recording while system indicates it may record
 * - PII handling based on templates (SSN collection etc.)
 */

import type { IssueV2, IssueTypeV2, IssueCategoryV2, SpeakerV2, VerificationLevelV2 } from '../types.js';
import { createHash } from 'crypto';

export interface ComplianceDetectorResult {
  issues: IssueV2[];
}

/**
 * D: Detect compliance issues from claims
 */
export function detectComplianceIssues(
  claims: Array<{ id: string; text: string; meta?: { speaker?: string; turnIndex?: number } }>,
  runId: string,
  conversationId: string,
  evidenceMode: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL'
): ComplianceDetectorResult {
  const issues: IssueV2[] = [];
  
  // D1: PCI/CVV Storage Detection
  const cvvIssues = detectCVVStorage(claims, runId, conversationId, evidenceMode);
  issues.push(...cvvIssues);
  
  // D2: Recording Consent Detection
  const recordingIssues = detectRecordingConsent(claims, runId, conversationId, evidenceMode);
  issues.push(...recordingIssues);
  
  // D3: PII Collection Detection
  const piiIssues = detectPIICollection(claims, runId, conversationId, evidenceMode);
  issues.push(...piiIssues);
  
  return { issues };
}

/**
 * D1: Detect CVV storage violations
 * Severity: CRITICAL
 * Pattern: "store CVV", "save CVV", "keep CVV", "CVV on file"
 */
function detectCVVStorage(
  claims: Array<{ id: string; text: string; meta?: { speaker?: string; turnIndex?: number } }>,
  runId: string,
  conversationId: string,
  evidenceMode: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL'
): IssueV2[] {
  const issues: IssueV2[] = [];
  const cvvPatterns = [
    /\b(store|save|keep|retain|hold|record|capture|collect).*cvv/gi,
    /\bcvv.*(store|save|keep|retain|hold|record|capture|collect|file|database)/gi,
    /\b(card.*verification.*value|CVV).*(store|save|keep|retain|hold|record)/gi,
  ];
  
  for (const claim of claims) {
    const text = claim.text.toLowerCase();
    const hasCVVMention = cvvPatterns.some(pattern => pattern.test(claim.text));
    
    if (hasCVVMention) {
      const issueKey = `pci_cvv_storage:${claim.id}`;
      const issueId = createHash('sha256').update(`${runId}:${issueKey}`).digest('hex').substring(0, 16);
      const topicId = 'payment_security';
      const slotKey = 'cvv:storage';
      const clusterKey = `compliance:PCI_CVV_STORAGE:${topicId}:${slotKey}:agent`;
      const clusterId = createHash('sha256').update(clusterKey).digest('hex').substring(0, 16);
      
      const speaker: SpeakerV2 = 
        claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT' ? 'AGENT' :
        claim.meta?.speaker === 'Customer' || claim.meta?.speaker === 'CUSTOMER' ? 'CUSTOMER' :
        'UNKNOWN';
      
      const verificationLevel: VerificationLevelV2 = evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL' ? 'EXTERNAL_VERIFIED' : 'TRANSCRIPT_ONLY';
      
      issues.push({
        issueId: `issue_${issueId}`,
        issueKey,
        clusterKey,
        clusterId,
        topicId,
        slotKey,
        runId,
        conversationId,
        type: 'PCI' as IssueTypeV2,
        category: 'compliance' as IssueCategoryV2,
        severity: 'high', // Critical severity is mapped to high (canonical)
        impact: 'high',
        riskScore: 0.95, // Will be recomputed, but set high for compliance
        score: 95,
        confidence: 0.9,
        reviewRequired: true,
        verification: {
          level: verificationLevel,
          reasonCodes: evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
        },
        who: {
          speaker,
          turnIndex: claim.meta?.turnIndex,
        },
        what: {
          primaryClaimId: claim.id,
          claimText: claim.text,
          issueSummary: 'PCI Violation: CVV storage detected',
          issueDetail: `The transcript contains language suggesting CVV (Card Verification Value) storage, which violates PCI-DSS compliance standards. CVV codes must never be stored after authorization. Claim: "${claim.text}"`,
        },
        evidence: {
          refs: [{
            sourceType: 'TRANSCRIPT',
            sourceId: `e-transcript-${claim.meta?.turnIndex || 0}`,
            quote: claim.text,
            turnIndex: claim.meta?.turnIndex,
          }],
          edges: [],
        },
        compliance: {
          tags: ['pci', 'cvv', 'payment_security', 'critical_compliance'],
          impactedPolicies: [{ policyId: 'PCI-DSS', section: '3.2' }],
          legalHoldSuggested: true,
          disclaimers: evidenceMode === 'TRANSCRIPT_ONLY' 
            ? ['This finding is grounded in transcript content only and is not externally verified.']
            : [],
        },
        scoring: {
          components: {
            impact01: 0,
            evidence01: 0,
            signal01: 0,
            category01: 0,
            verificationMultiplier: 1,
            risk01Raw: 0,
            risk01Final: 0,
          },
          weights: {
            impact: 0.4,
            evidence: 0.3,
            signal: 0.2,
            category: 0.1,
          },
          reasons: [],
        },
      scoring: {
        components: {
          impact01: 0,
          evidence01: 0,
          signal01: 0,
          category01: 0,
          verificationMultiplier: 1,
          risk01Raw: 0,
          risk01Final: 0,
        },
        weights: {
          impact: 0.4,
          evidence: 0.3,
          signal: 0.2,
          category: 0.1,
        },
        reasons: [],
      },
      audit: {
        createdAt: new Date().toISOString(),
        engineVersion: process.env.ENGINE_VERSION || '0.2.0',
        scorerId: 'compliance-detector-v1',
      },
    });
    }
  }
  
  return issues;
}

/**
 * D2: Detect recording consent violations
 * Severity: HIGH
 * Pattern: Agent denies recording while system indicates recording may occur
 */
function detectRecordingConsent(
  claims: Array<{ id: string; text: string; meta?: { speaker?: string; turnIndex?: number } }>,
  runId: string,
  conversationId: string,
  evidenceMode: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL'
): IssueV2[] {
  const issues: IssueV2[] = [];
  
  // Look for agent claims about recording
  const agentClaims = claims.filter(c => 
    c.meta?.speaker === 'Agent' || c.meta?.speaker === 'AGENT'
  );
  
  const recordingDenials = agentClaims.filter(c => {
    const text = c.text.toLowerCase();
    return /\b(not|don't|won't|can't|cannot).*(record|recording|recorded|taping|taped)/gi.test(text) ||
           /\b(no|never).*(record|recording|recorded|taping|taped)/gi.test(text);
  });
  
  const recordingAffirmations = agentClaims.filter(c => {
    const text = c.text.toLowerCase();
    return /\b(record|recording|recorded|taping|taped|monitor|monitoring)/gi.test(text) &&
           !/\b(not|don't|won't|can't|cannot|no|never)/gi.test(text);
  });
  
  // If agent both denies and affirms recording, that's a contradiction
  if (recordingDenials.length > 0 && recordingAffirmations.length > 0) {
    const denial = recordingDenials[0];
    const affirmation = recordingAffirmations[0];
    
    const issueKey = `recording_consent:${denial.id}:${affirmation.id}`;
    const issueId = createHash('sha256').update(`${runId}:${issueKey}`).digest('hex').substring(0, 16);
    const topicId = 'recording_consent';
    const slotKey = 'recording:consent';
    const clusterKey = `compliance:RECORDING_CONSENT:${topicId}:${slotKey}:agent`;
    const clusterId = createHash('sha256').update(clusterKey).digest('hex').substring(0, 16);
    
    const verificationLevel: VerificationLevelV2 = evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL' ? 'EXTERNAL_VERIFIED' : 'TRANSCRIPT_ONLY';
    
    issues.push({
      issueId: `issue_${issueId}`,
      issueKey,
      clusterKey,
      clusterId,
      topicId,
      slotKey,
      runId,
      conversationId,
      type: 'RECORDING_CONSENT' as IssueTypeV2,
      category: 'compliance' as IssueCategoryV2,
      severity: 'high',
      impact: 'high',
      riskScore: 0.85,
      score: 85,
      confidence: 0.8,
      reviewRequired: true,
      verification: {
        level: verificationLevel,
        reasonCodes: evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
      },
      who: {
        speaker: 'AGENT',
        turnIndex: denial.meta?.turnIndex,
      },
      what: {
        primaryClaimId: denial.id,
        relatedClaimIds: [affirmation.id],
        claimText: denial.text,
        issueSummary: 'Recording Consent Inconsistency',
        issueDetail: `Agent made contradictory statements about call recording. Denial: "${denial.text}". Affirmation: "${affirmation.text}". This may violate consent requirements.`,
      },
      evidence: {
        refs: [
          {
            sourceType: 'TRANSCRIPT',
            sourceId: `e-transcript-${denial.meta?.turnIndex || 0}`,
            quote: denial.text,
            turnIndex: denial.meta?.turnIndex,
          },
          {
            sourceType: 'TRANSCRIPT',
            sourceId: `e-transcript-${affirmation.meta?.turnIndex || 0}`,
            quote: affirmation.text,
            turnIndex: affirmation.meta?.turnIndex,
          },
        ],
        edges: [],
      },
      compliance: {
        tags: ['recording_consent', 'compliance', 'consent_violation'],
        impactedPolicies: [],
        legalHoldSuggested: false,
        disclaimers: evidenceMode === 'TRANSCRIPT_ONLY' 
          ? ['This finding is grounded in transcript content only and is not externally verified.']
          : [],
        },
      scoring: {
        components: {
          impact01: 0,
          evidence01: 0,
          signal01: 0,
          category01: 0,
          verificationMultiplier: 1,
          risk01Raw: 0,
          risk01Final: 0,
        },
        weights: {
          impact: 0.4,
          evidence: 0.3,
          signal: 0.2,
          category: 0.1,
        },
        reasons: [],
      },
      audit: {
        createdAt: new Date().toISOString(),
        engineVersion: process.env.ENGINE_VERSION || '0.2.0',
        scorerId: 'compliance-detector-v1',
      },
    });
  }
  
  return issues;
}

/**
 * D3: Detect PII collection (SSN, etc.)
 * Severity: HIGH
 * Pattern: SSN collection, full SSN mentioned, etc.
 */
function detectPIICollection(
  claims: Array<{ id: string; text: string; meta?: { speaker?: string; turnIndex?: number } }>,
  runId: string,
  conversationId: string,
  evidenceMode: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL'
): IssueV2[] {
  const issues: IssueV2[] = [];
  
  // SSN pattern: XXX-XX-XXXX or XXX XX XXXX
  const ssnPattern = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/;
  
  for (const claim of claims) {
    if (ssnPattern.test(claim.text)) {
      const issueKey = `pii_ssn:${claim.id}`;
      const issueId = createHash('sha256').update(`${runId}:${issueKey}`).digest('hex').substring(0, 16);
      const topicId = 'pii_collection';
      const slotKey = 'ssn:collection';
      const clusterKey = `compliance:PII_SSN:${topicId}:${slotKey}:agent`;
      const clusterId = createHash('sha256').update(clusterKey).digest('hex').substring(0, 16);
      
      const speaker: SpeakerV2 = 
        claim.meta?.speaker === 'Agent' || claim.meta?.speaker === 'AGENT' ? 'AGENT' :
        claim.meta?.speaker === 'Customer' || claim.meta?.speaker === 'CUSTOMER' ? 'CUSTOMER' :
        'UNKNOWN';
      
      const verificationLevel: VerificationLevelV2 = evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL' ? 'EXTERNAL_VERIFIED' : 'TRANSCRIPT_ONLY';
      
      issues.push({
        issueId: `issue_${issueId}`,
        issueKey,
        clusterKey,
        clusterId,
        topicId,
        slotKey,
        runId,
        conversationId,
        type: 'PII_COLLECTION' as IssueTypeV2,
        category: 'compliance' as IssueCategoryV2,
        severity: 'high',
        impact: 'high',
        riskScore: 0.80,
        score: 80,
        confidence: 0.85,
        reviewRequired: true,
        verification: {
          level: verificationLevel,
          reasonCodes: evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
        },
        who: {
          speaker,
          turnIndex: claim.meta?.turnIndex,
        },
        what: {
          primaryClaimId: claim.id,
          claimText: claim.text.replace(ssnPattern, 'XXX-XX-XXXX'), // Redact SSN in display
          issueSummary: 'PII Collection: SSN detected in transcript',
          issueDetail: `The transcript contains what appears to be a Social Security Number (SSN). SSNs are sensitive PII and should be handled according to privacy regulations. This may require redaction or secure handling.`,
        },
        evidence: {
          refs: [{
            sourceType: 'TRANSCRIPT',
            sourceId: `e-transcript-${claim.meta?.turnIndex || 0}`,
            quote: claim.text.replace(ssnPattern, 'XXX-XX-XXXX'), // Redact in evidence
            turnIndex: claim.meta?.turnIndex,
          }],
          edges: [],
        },
        compliance: {
          tags: ['pii', 'ssn', 'privacy', 'data_protection'],
          impactedPolicies: [],
          legalHoldSuggested: false,
          disclaimers: evidenceMode === 'TRANSCRIPT_ONLY' 
            ? ['This finding is grounded in transcript content only and is not externally verified.']
            : [],
        },
      scoring: {
        components: {
          impact01: 0,
          evidence01: 0,
          signal01: 0,
          category01: 0,
          verificationMultiplier: 1,
          risk01Raw: 0,
          risk01Final: 0,
        },
        weights: {
          impact: 0.4,
          evidence: 0.3,
          signal: 0.2,
          category: 0.1,
        },
        reasons: [],
      },
      audit: {
        createdAt: new Date().toISOString(),
        engineVersion: process.env.ENGINE_VERSION || '0.2.0',
        scorerId: 'compliance-detector-v1',
      },
    });
    }
  }
  
  return issues;
}


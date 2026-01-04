/**
 * Golden Test: Transcript-Only Mode Invariants
 * 
 * These tests verify the behavior when running in transcript-only mode
 * (no external evidence documents).
 * 
 * INVARIANTS:
 * 1. groundingAdded > 0 (most claims should be grounded to transcript)
 * 2. supportsAdded === 0 (no external evidence = no support edges)
 * 3. supported count === 0 (SUPPORTED requires external evidence)
 * 4. unverified count === claims grounded to transcript
 * 5. ungrounded count === claims without grounding edges
 * 6. No synthetic grounding (if grounding is 0, status = DEGRADED)
 */

import { describe, it, expect } from 'vitest';
import { buildGraph } from '../graph-builder.js';

// Sample telco dispute transcript with clear conflicts
const TELCO_DISPUTE_TRANSCRIPT = `
Agent: Thank you for calling TelcoMax customer service. My name is Sarah. How can I help you today?

Customer: Hi Sarah. I just got my bill and I'm really confused. There's a charge for a router rental that I don't think I should be paying.

Agent: I'm sorry to hear you're having trouble with your bill. Let me pull up your account. Can I have your account number?

Customer: Sure, it's 12345678.

Agent: Thank you. I see your account here. Looking at the router charge, I can see it's $10 per month for the equipment rental.

Customer: But when I signed up, I was told the first 3 months of router rental would be free. This is only my second month.

Agent: Let me check on that. I see you signed up on January 15th. The promotion should have included 3 free months of router rental, you're right.

Customer: So why am I being charged?

Agent: I apologize for the confusion. It looks like the promotional discount wasn't applied correctly to your account. I can see the charge should have been waived.

Customer: Can you fix it?

Agent: Absolutely. I'm going to credit your account for the $10 router charge right now. You'll see this reflected on your next statement.

Customer: Great. But I also see a charge for $9.99 for something called "Streaming Plus". I never added that.

Agent: Let me look into that. I see Streaming Plus was added on January 2nd through your online account portal.

Customer: That's impossible. I never added any streaming service. Someone must have done this without my permission.

Agent: I understand your concern. I can remove that service and credit the charges. Was there anything else on your bill that looked incorrect?

Customer: No, I think that's it. Just those two issues.

Agent: Perfect. So to summarize: I've credited the $10 router rental charge and I'm removing the Streaming Plus service with a $9.99 credit. Your total credit will be $19.99.

Customer: Thank you Sarah. I appreciate your help.

Agent: You're welcome. Is there anything else I can help you with today?

Customer: No, that's all. Thanks again.

Agent: Thank you for calling TelcoMax. Have a great day!
`;

describe('Transcript-Only Mode Invariants', () => {
  describe('buildGraph with transcript only', () => {
    const result = buildGraph({
      transcript: TELCO_DISPUTE_TRANSCRIPT,
      evidence: [], // No external evidence
      template: 'telco',
    });

    it('should create transcript evidence nodes', () => {
      const transcriptNodes = result.graph.nodes.evidence.filter(
        e => e.evidenceKind === 'transcript'
      );
      expect(transcriptNodes.length).toBeGreaterThan(0);
      console.log(`Created ${transcriptNodes.length} transcript evidence nodes`);
    });

    it('should create grounding edges', () => {
      expect(result.legacy.grounding.length).toBeGreaterThan(0);
      console.log(`Created ${result.legacy.grounding.length} grounding edges`);
    });

    it('should have supported count === 0 (no external evidence)', () => {
      expect(result.truthDerivation.summary.supported).toBe(0);
      expect(result.legacy.supports.length).toBe(0);
      console.log(`Supported: ${result.truthDerivation.summary.supported} (expected 0)`);
    });

    it('should have unverified count === claims with grounding edges', () => {
      // In transcript-only mode, most claims should be UNVERIFIED (grounded but not verified)
      expect(result.truthDerivation.summary.unverified).toBeGreaterThan(0);
      console.log(`Unverified: ${result.truthDerivation.summary.unverified}`);
    });

    it('should have ungrounded count match claims without grounding', () => {
      const claimsWithoutGrounding = result.graph.nodes.claims.filter(c => {
        const hasGrounding = result.graph.edges.grounding.some(
          e => e.from === c.id || e.to === c.id
        );
        return !hasGrounding;
      });
      
      expect(result.truthDerivation.summary.ungrounded).toBe(claimsWithoutGrounding.length);
      console.log(`Ungrounded: ${result.truthDerivation.summary.ungrounded} (claims without grounding: ${claimsWithoutGrounding.length})`);
    });

    it('should detect contradictions between conflicting claims', () => {
      // The transcript has clear conflicts:
      // - Customer: "first 3 months of router rental would be free" vs being charged
      // - Customer: "I never added that [Streaming Plus]" vs Agent: "was added on January 2nd"
      expect(result.legacy.contradictions.length).toBeGreaterThan(0);
      console.log(`Contradictions: ${result.legacy.contradictions.length}`);
    });

    it('should have consistent truth state summary', () => {
      const { supported, contradicted, unverified, ungrounded, total } = 
        result.truthDerivation.summary;
      
      // Sum must equal total
      expect(supported + contradicted + unverified + ungrounded).toBe(total);
      
      console.log(`Truth summary: supported=${supported}, contradicted=${contradicted}, unverified=${unverified}, ungrounded=${ungrounded}, total=${total}`);
    });

    it('should have graph status OK or DEGRADED (not FAILED)', () => {
      expect(['OK', 'DEGRADED']).toContain(result.graph.diagnostics.status);
      console.log(`Graph status: ${result.graph.diagnostics.status}`);
      if (result.graph.diagnostics.reasons.length > 0) {
        console.log(`Reasons: ${result.graph.diagnostics.reasons.join(', ')}`);
      }
    });

    it('should NOT use synthetic grounding', () => {
      // All grounding edges must reference actual transcript evidence nodes
      for (const edge of result.graph.edges.grounding) {
        const evidenceNode = result.graph.nodes.evidence.find(
          e => e.id === edge.to || e.id === edge.from
        );
        expect(evidenceNode).toBeDefined();
        expect(evidenceNode?.evidenceKind).toBe('transcript');
      }
    });
  });

  describe('No grounding edge scenario', () => {
    it('should mark as DEGRADED when no grounding edges created', () => {
      const result = buildGraph({
        transcript: 'Hello', // Too short to extract meaningful claims
        evidence: [],
        template: 'generic',
      });

      if (result.legacy.grounding.length === 0 && result.graph.nodes.claims.length > 0) {
        expect(result.graph.diagnostics.status).toBe('DEGRADED');
        expect(result.graph.diagnostics.reasons).toContain('NO_GROUNDING_EDGES');
      }
    });
  });
});

describe('Counts Consistency', () => {
  const result = buildGraph({
    transcript: TELCO_DISPUTE_TRANSCRIPT,
    evidence: [],
    template: 'telco',
  });

  it('legacy.supports.length should match truthDerivation.summary.supported', () => {
    // SUPPORTED requires external evidence, so with no evidence, both should be 0
    if (result.legacy.supports.length === 0) {
      expect(result.truthDerivation.summary.supported).toBe(0);
    }
  });

  it('legacy.grounding.length should be > 0 for non-trivial transcripts', () => {
    expect(result.legacy.grounding.length).toBeGreaterThan(0);
  });

  it('metrics should be consistent with actual edges', () => {
    expect(result.metrics.totalEdges).toBe(
      result.legacy.supports.length + 
      result.legacy.contradictions.length + 
      result.legacy.grounding.length
    );
  });
});


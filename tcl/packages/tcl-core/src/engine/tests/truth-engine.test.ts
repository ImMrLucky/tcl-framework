/**
 * Golden tests for the deterministic Truth Engine.
 * 
 * Verifies:
 * 1. Claim extraction works
 * 2. Fact normalization produces expected facts
 * 3. Rule engine detects contradictions
 * 4. Output is reproducible
 */

import { describe, it, expect } from 'vitest';
import { runTruthEngine, buildIssuesFromGraph } from '../truth-engine.js';

const SAMPLE_TRANSCRIPT = `Agent: Thank you for calling BrightLine Services. My name is Alex. How can I help you today?

Customer: Hi, I'm calling because my bill this month is higher than usual, and I was told my rate wouldn't change.

Agent: I understand your concern. Based on what I can see, your plan itself hasn't changed.

Customer: Okay, but the total is about twenty dollars more.

Agent: Sometimes additional charges can appear depending on usage or fees.

Customer: When I signed up, I was told there wouldn't be any extra fees.

Agent: Right, there are no extra fees on your account.

Customer: Then why is the bill higher?

Agent: Let me take another look… I do see a monthly service adjustment fee that started this cycle.

Customer: I wasn't told about that. Can I cancel without a penalty?

Agent: Yes, you can cancel at any time without a cancellation fee.

Customer: That's good to know.

Agent: Just to clarify, if you cancel before the end of your promotional period, there may be an early termination charge.

Customer: So there is a cancellation fee?

Agent: It depends on the situation, but in some cases, yes.

Customer: That's not what I was told before.

Agent: I apologize for the confusion. The full details are outlined in the service agreement.

Customer: Can you send me something in writing?

Agent: Yes, I can email you a copy of your agreement and the billing breakdown right after this call.

Customer: Okay, please do. I just want to understand what I'm being charged for.

Agent: Absolutely. I'll make sure that information is sent over today.`;

describe('Truth Engine', () => {
  it('extracts claims from sample transcript', () => {
    const result = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    
    expect(result.graph.claims.length).toBeGreaterThanOrEqual(10);
    console.log(`Claims: ${result.graph.claims.length}`);
  });
  
  it('extracts facts about fees', () => {
    const result = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    
    // Should have facts about cancellation fees, extra fees, etc.
    const feeFactSubjects = result.graph.facts
      .map(f => f.subject)
      .filter(s => s.includes('fee'));
    
    expect(feeFactSubjects.length).toBeGreaterThan(0);
    console.log(`Fee-related facts: ${feeFactSubjects.length}`);
    console.log(`Subjects: ${[...new Set(feeFactSubjects)].join(', ')}`);
  });
  
  it('detects contradictions', () => {
    const result = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    
    // Should detect contradictions around:
    // - "no extra fees" vs "adjustment fee started"
    // - "cancel without fee" vs "early termination charge"
    expect(result.graph.contradictionEdges.length).toBeGreaterThanOrEqual(1);
    
    console.log(`Contradictions: ${result.graph.contradictionEdges.length}`);
    for (const edge of result.graph.contradictionEdges.slice(0, 3)) {
      console.log(`  - ${edge.ruleId}: ${edge.reason.substring(0, 80)}...`);
    }
  });
  
  it('generates structure edges', () => {
    const result = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    
    expect(result.graph.structureEdges.length).toBeGreaterThan(0);
    console.log(`Structure edges: ${result.graph.structureEdges.length}`);
  });
  
  it('is reproducible (same input = same output)', () => {
    const result1 = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    const result2 = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    
    expect(result1.graph.inputHash).toBe(result2.graph.inputHash);
    expect(result1.graph.claims.length).toBe(result2.graph.claims.length);
    expect(result1.graph.contradictionEdges.length).toBe(result2.graph.contradictionEdges.length);
    
    // Same claim IDs
    const ids1 = result1.graph.claims.map(c => c.id).sort();
    const ids2 = result2.graph.claims.map(c => c.id).sort();
    expect(ids1).toEqual(ids2);
  });
  
  it('is fast (< 100ms for sample transcript)', () => {
    const result = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    
    // Should be dramatically faster than NLI (~100s)
    expect(result.timings.total).toBeLessThan(100);
    console.log(`Total time: ${result.timings.total}ms`);
  });
  
  it('builds issues from graph', () => {
    const result = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    const issues = buildIssuesFromGraph(result.graph);
    
    expect(issues.length).toBe(result.graph.contradictionEdges.length);
    
    // At least one should be high/critical severity
    const highSeverity = issues.filter(i => i.severity === 'high' || i.severity === 'critical');
    console.log(`Issues: ${issues.length} (${highSeverity.length} high/critical)`);
    
    for (const issue of issues.slice(0, 3)) {
      console.log(`  - [${issue.severity}] ${issue.type}: ${issue.description.substring(0, 60)}...`);
    }
  });
  
  it('produces spectral-compatible output', () => {
    const result = runTruthEngine({ transcript: SAMPLE_TRANSCRIPT });
    
    // Should have the right shape for spectral.py
    expect(result.spectralInput.claims.length).toBeGreaterThan(0);
    expect(Array.isArray(result.spectralInput.supports)).toBe(true);
    expect(Array.isArray(result.spectralInput.contradictions)).toBe(true);
    expect(Array.isArray(result.spectralInput.grounded)).toBe(true);
    
    // Claims have id and text
    const firstClaim = result.spectralInput.claims[0];
    expect(firstClaim.id).toBeDefined();
    expect(firstClaim.text).toBeDefined();
    
    // Edges have weight
    if (result.spectralInput.contradictions.length > 0) {
      const firstEdge = result.spectralInput.contradictions[0];
      expect(firstEdge.claimA).toBeDefined();
      expect(firstEdge.claimB).toBeDefined();
      expect(typeof firstEdge.weight).toBe('number');
    }
  });
});


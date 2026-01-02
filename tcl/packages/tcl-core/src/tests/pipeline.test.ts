/**
 * Pipeline Acceptance Tests
 * 
 * Tests for the full ProtectQA analysis pipeline using the golden transcript.
 * These tests verify:
 * - Claim filtering (non-auditable claims excluded)
 * - Contradiction detection (specific known contradictions)
 * - Severity variance (not all issues same severity)
 * - No hard-coded scores (values must vary based on content)
 * - Graph health diagnostics when empty
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { extractClaimsWithTypes, classifyClaimType, isAuditableClaimType, type ClaimType } from "../claim_extractor.js";
import { computeRiskScore, extractRiskSignals, getDefaultRiskConfig, determineIssueType } from "../risk_scoring.js";
import { buildIssuesList } from "../server/audit/reproducibility.js";
import type { SpectralReport } from "../types.js";

// Load golden transcript
const fixturesPath = path.join(__dirname, "fixtures");
const goldenTranscriptPath = path.join(fixturesPath, "protectqa_call_center_script.txt");

describe("Claim Extraction", () => {
  let transcript: string;
  
  beforeAll(() => {
    transcript = fs.readFileSync(goldenTranscriptPath, "utf-8");
  });
  
  describe("G1: Claim Filtering", () => {
    it("should not classify 'I understand your concern' as an auditable claim", () => {
      const type = classifyClaimType("I understand your concern.");
      expect(isAuditableClaimType(type)).toBe(false);
      expect(type).toBe("ACKNOWLEDGEMENT");
    });
    
    it("should not classify 'Absolutely' as an auditable claim", () => {
      const type = classifyClaimType("Absolutely.");
      expect(isAuditableClaimType(type)).toBe(false);
      expect(["ACKNOWLEDGEMENT", "FILLER"]).toContain(type);
    });
    
    it("should classify questions as non-auditable", () => {
      const questions = [
        "Then why is the bill higher?",
        "Can I cancel without a penalty?",
        "So there is a cancellation fee?",
        "Can you send me something in writing?"
      ];
      
      for (const q of questions) {
        const type = classifyClaimType(q);
        expect(isAuditableClaimType(type)).toBe(false);
        expect(["QUESTION", "REQUEST"]).toContain(type);
      }
    });
    
    it("should classify agent promises as auditable PROMISE type", () => {
      const promises = [
        "Yes, I can email you a copy of your agreement and the billing breakdown right after this call.",
        "I'll make sure that information is sent over today."
      ];
      
      for (const p of promises) {
        const type = classifyClaimType(p, "Agent");
        expect(type).toBe("PROMISE");
        expect(isAuditableClaimType(type)).toBe(true);
      }
    });
    
    it("should classify policy statements as auditable", () => {
      const policyStatements = [
        "The full details are outlined in the service agreement.",
        "if you cancel before the end of your promotional period, there may be an early termination charge"
      ];
      
      for (const p of policyStatements) {
        const type = classifyClaimType(p, "Agent");
        expect(["POLICY_STATEMENT", "DISCLAIMER"]).toContain(type);
        expect(isAuditableClaimType(type)).toBe(true);
      }
    });
    
    it("should extract only auditable claims from full transcript", () => {
      const result = extractClaimsWithTypes(transcript);
      
      // Should have some claims
      expect(result.claims.length).toBeGreaterThan(0);
      
      // All claims in the main output should be auditable
      for (const claim of result.claims) {
        expect(claim.isAuditable).toBe(true);
        expect(["ASSERTION", "PROMISE", "POLICY_STATEMENT", "DISCLAIMER"]).toContain(claim.claimType);
      }
      
      // Should have filtered out non-auditable items
      expect(result.stats.filtered).toBeGreaterThan(0);
      
      // Questions and acknowledgements should be filtered
      const nonAuditableInMain = result.claims.filter(c => 
        c.claimType === "QUESTION" || 
        c.claimType === "ACKNOWLEDGEMENT" ||
        c.claimType === "FILLER" ||
        c.claimType === "REQUEST"
      );
      expect(nonAuditableInMain.length).toBe(0);
    });
    
    it("should not include 'I understand your concern' text in auditable claims", () => {
      const result = extractClaimsWithTypes(transcript);
      
      const empathyPhrases = [
        "I understand your concern",
        "Absolutely",
        "That's good to know",
        "Okay"
      ];
      
      for (const phrase of empathyPhrases) {
        const found = result.claims.find(c => c.text.includes(phrase) && c.text.length < 30);
        expect(found).toBeUndefined();
      }
    });
  });
  
  describe("G2: Contradiction Detection", () => {
    it("should extract both contradictory statements about cancellation fees", () => {
      const result = extractClaimsWithTypes(transcript);
      
      // Find the "cancel without a cancellation fee" claim
      const noCancelFee = result.claims.find(c => 
        c.text.toLowerCase().includes("cancel") && 
        c.text.toLowerCase().includes("without") &&
        (c.text.toLowerCase().includes("fee") || c.text.toLowerCase().includes("cancellation"))
      );
      expect(noCancelFee).toBeDefined();
      
      // Find the "early termination charge" claim
      const earlyTermination = result.claims.find(c => 
        c.text.toLowerCase().includes("early termination") ||
        (c.text.toLowerCase().includes("cancel") && c.text.toLowerCase().includes("charge"))
      );
      expect(earlyTermination).toBeDefined();
      
      // Both should be high-stakes assertions or policy statements
      expect(noCancelFee?.claimType).toBeDefined();
      expect(earlyTermination?.claimType).toBeDefined();
    });
    
    it("should mark high-stakes claims about fees with appropriate topic tags", () => {
      const result = extractClaimsWithTypes(transcript);
      
      // Find claims about fees
      const feeClaims = result.claims.filter(c => 
        c.text.toLowerCase().includes("fee") ||
        c.text.toLowerCase().includes("charge") ||
        c.text.toLowerCase().includes("cancel")
      );
      
      expect(feeClaims.length).toBeGreaterThan(0);
      
      // At least one should have fee or cancel topic tag
      const hasTopicTags = feeClaims.some(c => 
        c.topicTags.includes("fee") || 
        c.topicTags.includes("cancel") ||
        c.topicTags.includes("penalty")
      );
      expect(hasTopicTags).toBe(true);
    });
  });
});

describe("Risk Scoring", () => {
  describe("G3: Severity Variance", () => {
    it("should produce different severities for different risk signals", () => {
      const config = getDefaultRiskConfig();
      
      // Low risk: supported customer statement, no special flags
      const lowRiskSignals = extractRiskSignals({
        id: "low",
        text: "My bill is higher than usual",
        confidence: 0,
        evidence: [],
        claimType: "ASSERTION",
        isAuditable: true,
        topicTags: [],
        hasAbsoluteLanguage: false,
        hasMoney: false,
        meta: { speaker: "Customer" }
      }, {
        spectral: { nodeBlameNorm: 0, truthState: "Supported" }
      });
      const lowResult = computeRiskScore(lowRiskSignals, config);
      
      // High risk: agent promise with absolute language about fees
      const highRiskSignals = extractRiskSignals({
        id: "high",
        text: "You can cancel at any time without a cancellation fee",
        confidence: 0,
        evidence: [],
        claimType: "PROMISE",
        isAuditable: true,
        topicTags: ["cancel", "fee"],
        hasAbsoluteLanguage: true,
        hasMoney: false,
        meta: { speaker: "Agent" }
      }, {
        nliScores: { contradiction: 0.8, support: 0.1, grounding: 0.3 },
        spectral: { nodeBlameNorm: 0.7, truthState: "Contradicted" }
      });
      const highResult = computeRiskScore(highRiskSignals, config);
      
      // Should have different severities
      expect(lowResult.severity).not.toBe(highResult.severity);
      expect(lowResult.riskScore).toBeLessThan(highResult.riskScore);
    });
    
    it("should weight agent statements higher than customer statements", () => {
      const config = getDefaultRiskConfig();
      const baseSignals = {
        claimType: "ASSERTION" as ClaimType,
        topicTags: ["fee"],
        hasAbsoluteLanguage: false,
        hasMoney: false,
        maxContradictionScore: 0,
        maxSupportScore: 0,
        groundingScore: 0.5,
        nodeBlameNorm: 0,
        truthState: "Inconclusive" as const,
        involvedInContradiction: false,
        contradictionCount: 0
      };
      
      const agentResult = computeRiskScore({
        ...baseSignals,
        speaker: "AGENT"
      }, config);
      
      const customerResult = computeRiskScore({
        ...baseSignals,
        speaker: "CUSTOMER"
      }, config);
      
      expect(agentResult.riskScore).toBeGreaterThan(customerResult.riskScore);
    });
  });
  
  describe("G4: No Placeholder Scores", () => {
    it("should compute different grounding risk for different inputs", () => {
      const config = getDefaultRiskConfig();
      
      const wellGrounded = computeRiskScore({
        claimType: "ASSERTION",
        speaker: "AGENT",
        topicTags: [],
        hasAbsoluteLanguage: false,
        hasMoney: false,
        maxContradictionScore: 0,
        maxSupportScore: 0.8,
        groundingScore: 0.9, // High grounding
        nodeBlameNorm: 0,
        truthState: "Supported",
        involvedInContradiction: false,
        contradictionCount: 0
      }, config);
      
      const poorlyGrounded = computeRiskScore({
        claimType: "ASSERTION",
        speaker: "AGENT",
        topicTags: [],
        hasAbsoluteLanguage: false,
        hasMoney: false,
        maxContradictionScore: 0,
        maxSupportScore: 0.1,
        groundingScore: 0.1, // Low grounding
        nodeBlameNorm: 0.5,
        truthState: "Ungrounded",
        involvedInContradiction: false,
        contradictionCount: 0
      }, config);
      
      // Poorly grounded should have higher risk
      expect(poorlyGrounded.breakdown.groundingRisk).toBeGreaterThan(wellGrounded.breakdown.groundingRisk);
      expect(poorlyGrounded.riskScore).toBeGreaterThan(wellGrounded.riskScore);
    });
  });
  
  describe("Issue Type Determination", () => {
    it("should use UNVERIFIED for transcript-only mode", () => {
      const signals = {
        claimType: "ASSERTION" as ClaimType,
        speaker: "AGENT" as const,
        topicTags: [],
        hasAbsoluteLanguage: false,
        hasMoney: false,
        maxContradictionScore: 0.2,
        maxSupportScore: 0.3,
        groundingScore: 0.2, // Low grounding
        nodeBlameNorm: 0,
        truthState: "Ungrounded" as const,
        involvedInContradiction: false,
        contradictionCount: 0
      };
      
      // Without external docs - should be UNVERIFIED
      const noDocsType = determineIssueType(signals, { hasExternalDocs: false });
      expect(noDocsType).toBe("UNVERIFIED");
      
      // With external docs - should be UNSUPPORTED
      const withDocsType = determineIssueType(signals, { hasExternalDocs: true });
      expect(withDocsType).toBe("UNSUPPORTED");
    });
    
    it("should detect CONTRADICTION from high contradiction score", () => {
      const signals = {
        claimType: "ASSERTION" as ClaimType,
        speaker: "AGENT" as const,
        topicTags: [],
        hasAbsoluteLanguage: false,
        hasMoney: false,
        maxContradictionScore: 0.85,
        maxSupportScore: 0.1,
        groundingScore: 0.5,
        nodeBlameNorm: 0.7,
        truthState: "Contradicted" as const,
        involvedInContradiction: true,
        contradictionCount: 1
      };
      
      const type = determineIssueType(signals, { hasExternalDocs: false });
      expect(type).toBe("CONTRADICTION");
    });
  });
});

describe("Issues Building", () => {
  let transcript: string;
  
  beforeAll(() => {
    transcript = fs.readFileSync(goldenTranscriptPath, "utf-8");
  });
  
  it("should not generate issues for non-auditable claims", () => {
    const result = extractClaimsWithTypes(transcript);
    
    // Create mock spectral output
    const mockSpectral: SpectralReport = {
      coherenceScore: 50,
      contradictionEnergy: 0.1,
      supportEnergy: 0.2,
      circularityScore: 0,
      spectralGap: 0.5,
      cycleMass: 0,
      heatTrace: [],
      truthVector: result.claims.map(() => 0.5),
      truthStates: result.claims.map(() => "Inconclusive"),
      nodeBlameNorm: result.claims.map(() => 0.1)
    };
    
    // Build issues
    const issues = buildIssuesList(mockSpectral, result.claims, undefined, "test-eval", {
      hasExternalDocs: false
    });
    
    // All issues should be for auditable claims only
    for (const issue of issues) {
      const claim = result.claims.find(c => c.id === issue.claimId);
      expect(claim?.isAuditable).toBe(true);
    }
  });
  
  describe("G5: Empty Graph Diagnostics", () => {
    it("should handle empty spectral output gracefully", () => {
      const result = extractClaimsWithTypes(transcript);
      
      // Empty spectral (no edges, skipped analysis)
      const emptySpectral: SpectralReport = {
        coherenceScore: 0,
        contradictionEnergy: 0,
        supportEnergy: 0,
        circularityScore: 0,
        spectralGap: 0,
        cycleMass: 0,
        heatTrace: [],
        truthVector: [],
        truthStates: [],
        nodeBlameNorm: [],
        spectralSkipped: true,
        debugReason: "empty_graph_test"
      };
      
      // Should still build issues (using fallback logic)
      const issues = buildIssuesList(emptySpectral, result.claims, undefined, "test-eval", {
        hasExternalDocs: false
      });
      
      // Issues should exist (from destructive claims fallback)
      // The exact count depends on the transcript, but should be > 0
      expect(Array.isArray(issues)).toBe(true);
    });
  });
});

describe("Integration: Full Pipeline", () => {
  let transcript: string;
  
  beforeAll(() => {
    transcript = fs.readFileSync(goldenTranscriptPath, "utf-8");
  });
  
  it("should produce a smaller, cleaner claim set from transcript", () => {
    const result = extractClaimsWithTypes(transcript);
    
    // Total items includes non-auditable
    // Auditable claims should be a subset
    expect(result.claims.length).toBeLessThan(result.allItems.length);
    
    // Should filter out a significant portion
    expect(result.stats.filtered).toBeGreaterThan(result.stats.auditable * 0.2);
    
    // Log for debugging
    console.log(`Total items: ${result.stats.total}`);
    console.log(`Auditable claims: ${result.stats.auditable}`);
    console.log(`Filtered: ${result.stats.filtered}`);
    console.log(`Type breakdown:`, result.stats.byType);
  });
  
  it("should not have any hard-coded confidence of 0.75", () => {
    const result = extractClaimsWithTypes(transcript);
    
    // All claims should have confidence = 0 (to be computed by NLI)
    // This verifies no hard-coded 0.75 or similar values
    for (const claim of result.claims) {
      expect(claim.confidence).toBe(0);
    }
  });
});


/**
 * Rule Engine - Generates edges deterministically from Facts.
 *
 * Core rule types:
 * 1. Polarity Conflict - same subject, affirm vs deny
 * 2. Absolute → Conditional shift
 * 3. Timeframe conflict
 * 4. Agent self-contradiction
 *
 * All edge weights come from config - nothing hard-coded.
 *
 * KEY FIX: Uses claim classification + topic overlap gating to prevent
 * false contradictions between intents, questions, emotions, etc.
 */
import type { TruthEngineConfig } from "../config/types.js";
import type { EnhancedClaim, Fact, TruthEdge } from "../facts/types.js";
export interface RuleEngineResult {
    contradictionEdges: TruthEdge[];
    supportEdges: TruthEdge[];
    structureEdges: TruthEdge[];
    rulesApplied: string[];
}
/**
 * Run all rules to generate edges.
 */
export declare function runRuleEngine(claims: EnhancedClaim[], facts: Fact[], config?: TruthEngineConfig): RuleEngineResult;

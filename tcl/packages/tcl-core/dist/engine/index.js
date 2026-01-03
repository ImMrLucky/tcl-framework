/**
 * Deterministic Truth Graph Engine
 *
 * Replaces NLI-based edge generation with rule-based, auditable logic.
 *
 * Usage:
 *   import { runTruthEngine } from './engine';
 *   const result = runTruthEngine({ transcript });
 */
export { runTruthEngine, toLegacyGraph, buildIssuesFromGraph } from './truth-engine.js';
export { extractEnhancedClaims, extractFacts } from './facts/fact-extractor.js';
export { runRuleEngine } from './rules/rule-engine.js';
export { DEFAULT_CONFIG } from './config/types.js';

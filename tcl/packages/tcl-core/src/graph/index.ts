/**
 * Graph Module - Exports
 * 
 * This module provides the complete pipeline for building semantically correct
 * Claim-Evidence-Action Graphs that spectral.py can analyze.
 * 
 * Main entry point: buildGraph()
 */

// Core types
export * from './types.js';

// Template configuration
export * from './template-config.js';

// Subject slot computation (THE KEY UPGRADE)
// Note: slotsMatch and slotsCompatible are exported from types.js, 
// so we selectively export from subject-slot.js to avoid conflicts
export { 
  extractEntities, 
  computeSubjectSlot, 
  computeSlotSimilarity,
  valuesContradict,
} from './subject-slot.js';

// Topic segmentation & gating
export * from './topic-segmentation.js';

// 3-stage pipeline
export * from './candidate-generation.js';
export * from './edge-classification.js';
export * from './weight-calibration.js';

// Truth state derivation
export * from './truth-state-derivation.js';

// Run diagnostics
export * from './run-diagnostics.js';

// Main graph builder
export * from './graph-builder.js';

// Legacy edge builder (for backward compatibility)
export { buildClaimGraph } from './edge_builder.js';


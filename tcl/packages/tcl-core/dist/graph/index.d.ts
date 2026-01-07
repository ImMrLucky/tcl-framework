/**
 * Graph Module - Exports
 *
 * This module provides the complete pipeline for building semantically correct
 * Claim-Evidence-Action Graphs that spectral.py can analyze.
 *
 * Main entry point: buildGraph()
 */
export * from './types.js';
export * from './template-config.js';
export { extractEntities, computeSubjectSlot, computeSlotSimilarity, valuesContradict, } from './subject-slot.js';
export * from './topic-segmentation.js';
export * from './candidate-generation.js';
export * from './edge-classification.js';
export * from './weight-calibration.js';
export * from './truth-state-derivation.js';
export * from './run-diagnostics.js';
export * from './graph-builder.js';
export { buildClaimGraph } from './edge_builder.js';

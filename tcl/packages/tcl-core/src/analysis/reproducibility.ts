/**
 * Reproducibility Utilities
 * 
 * Computes all reproducibility hashes and metadata required for audit-grade findings.
 */

import { createHash } from "crypto";
import { computeConfigHash } from "../config/loader.js";
import { getScoringConfig } from "../config/scoring.js";
import { getTemplates } from "../config/templates.js";
import { getTaxonomy } from "../config/taxonomy.js";

/**
 * Get git commit SHA (code version).
 * Falls back to ENGINE_VERSION env var or "unknown" if not available.
 */
export function getCodeVersion(): string {
  // Try to get from environment (set at build time)
  if (process.env.GIT_COMMIT) {
    return process.env.GIT_COMMIT;
  }
  
  // Try ENGINE_VERSION as fallback
  if (process.env.ENGINE_VERSION) {
    return process.env.ENGINE_VERSION;
  }
  
  // Try to read from git if available (development only)
  try {
    const { execSync } = require('child_process');
    const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (gitCommit) {
      return gitCommit.substring(0, 16); // Short hash
    }
  } catch (e) {
    // Git not available or not in a git repo
  }
  
  return "unknown";
}

/**
 * Get engine version.
 */
export function getEngineVersion(): string {
  return process.env.ENGINE_VERSION || "0.2.0";
}

/**
 * Compute hash of normalized transcript input.
 */
export function computeInputHash(transcript: string): string {
  // Normalize: trim, lowercase for consistency
  const normalized = transcript.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/**
 * Get model fingerprint (all model versions used).
 */
export function getModelFingerprint(): {
  nliModel?: string;
  claimExtractor?: string;
  embeddingModel?: string;
  spectralEngine?: string;
  configHash?: string;
} {
  const configHash = computeConfigHash();
  
  return {
    nliModel: "none-rules-only", // Truth engine doesn't use NLI
    claimExtractor: "truth-engine-v1",
    embeddingModel: "none", // Truth engine doesn't use embeddings
    spectralEngine: process.env.SPECTRAL_VERSION || "v1.0.0",
    configHash,
  };
}

/**
 * Compute full config hash (scoring + templates + taxonomy).
 */
export function computeFullConfigHash(): string {
  return computeConfigHash();
}

/**
 * Generate complete reproducibility metadata.
 */
export function generateReproducibilityMetadata(transcript: string): {
  inputHash: string;
  configHash: string;
  codeVersion: string;
  engineVersion: string;
  modelFingerprint: ReturnType<typeof getModelFingerprint>;
} {
  return {
    inputHash: computeInputHash(transcript),
    configHash: computeFullConfigHash(),
    codeVersion: getCodeVersion(),
    engineVersion: getEngineVersion(),
    modelFingerprint: getModelFingerprint(),
  };
}


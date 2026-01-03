/**
 * Domain Configurations
 * 
 * The TCL engine is universal. Each app loads its domain config at startup.
 * 
 * Usage:
 *   import { setNLPConfig } from '@tcl/core/nlp';
 *   import { CALL_CENTER_CONFIG } from '@tcl/core/nlp/configs';
 *   
 *   // At app startup
 *   setNLPConfig(CALL_CENTER_CONFIG);
 */

export { CALL_CENTER_CONFIG } from './call-center.js';
export { COMMERCIAL_LOANS_CONFIG } from './commercial-loans.js';

// Re-export types for convenience
export type { NLPConfig, EntityPattern, SynonymGroup, ActionPattern } from '../config.js';

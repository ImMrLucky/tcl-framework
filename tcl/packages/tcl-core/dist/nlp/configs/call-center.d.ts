/**
 * Call Center Domain Configuration
 *
 * This is loaded by the call center app to extend the universal config.
 * Other apps (loans, AI chat) would have their own configs.
 *
 * Usage in app:
 *   import { setNLPConfig } from '@tcl/core/nlp';
 *   import { CALL_CENTER_CONFIG } from '@tcl/core/nlp/configs/call-center';
 *   setNLPConfig(CALL_CENTER_CONFIG);
 */
import type { NLPConfig } from '../config.js';
/**
 * Full call center config
 */
export declare const CALL_CENTER_CONFIG: Partial<NLPConfig>;
export default CALL_CENTER_CONFIG;

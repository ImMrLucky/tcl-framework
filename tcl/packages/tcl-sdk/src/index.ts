/**
 * @protectqa/tcl-sdk — use TCL outside ProtectQA / Agent Studio.
 *
 * Re-exports the engine and studio adapters from tcl-core. Apps should depend
 * on this package rather than importing tcl-core server paths directly.
 */

export {
  validate,
  runStudioTclAnalysis,
  mapStudioArtifactToValidateInput,
  buildArtifactFromAgentRun,
} from 'tcl-core';

export type {
  ValidateInput,
  ValidateOutput,
  Source,
  Suggestion,
  StudioWorkArtifact,
  StudioTclReport,
  StudioTclTrigger,
  RunStudioAnalysisOptions,
} from 'tcl-core';

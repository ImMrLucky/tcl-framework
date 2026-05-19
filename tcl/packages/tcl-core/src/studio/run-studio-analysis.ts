import { validate } from '../orchestrator.js';
import { mapStudioArtifactToValidateInput } from './map-agent-work.js';
import {
  mapValidateOutputToStudioReport,
  type StudioTclReport,
  type StudioTclTrigger,
  type StudioWorkArtifact,
} from './types.js';

export type RunStudioAnalysisOptions = {
  trigger: StudioTclTrigger;
  templateId?: string;
  teamId?: string;
  agentRunId?: string;
  analysisId?: string;
};

/**
 * Run the TCL engine on agent-studio work (specs, code, orchestration output).
 * This is the single entry point Agent Studio and @protectqa/tcl-sdk should use.
 */
export async function runStudioTclAnalysis(
  artifact: StudioWorkArtifact,
  opts: RunStudioAnalysisOptions
): Promise<StudioTclReport> {
  const started = Date.now();
  const input = mapStudioArtifactToValidateInput(artifact, {
    templateId: opts.templateId,
  });
  const output = await validate(input);
  return mapValidateOutputToStudioReport(opts.trigger, output, Date.now() - started, {
    teamId: opts.teamId ?? artifact.teamId,
    agentRunId: opts.agentRunId ?? artifact.agentRunId,
    analysisId: opts.analysisId,
  });
}

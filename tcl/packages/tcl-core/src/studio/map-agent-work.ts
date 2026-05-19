import type { Source, ValidateInput } from '../types.js';
import type { StudioWorkArtifact } from './types.js';

/**
 * Maps Agent Studio artifacts (task + agent output + context) into TCL ValidateInput.
 * Keeps the TCL engine unchanged — studio is an adapter layer.
 */
export function mapStudioArtifactToValidateInput(
  artifact: StudioWorkArtifact,
  opts?: { templateId?: string }
): ValidateInput {
  const sources: Source[] | undefined = artifact.sources?.length
    ? artifact.sources.map((s, i) => ({
        id: s.id || `source-${i + 1}`,
        text: s.label ? `[${s.label}]\n${s.text}` : s.text,
      }))
    : undefined;

  return {
    question: artifact.question.trim() || 'Review agent work product',
    answer: artifact.answer.trim() || '(empty output)',
    sources,
    options: {
      repair: false,
      template: opts?.templateId ?? 'generic',
    },
  };
}

/** Build a studio artifact from an agent run row + optional task context. */
export function buildArtifactFromAgentRun(params: {
  taskTitle?: string | null;
  taskDescription?: string | null;
  useCase?: string | null;
  output?: string | null;
  contextSources?: Array<{ id: string; text: string; label?: string }>;
  teamId: string;
  agentId: string;
  taskId?: string | null;
  agentRunId: string;
  teamRunId?: string | null;
}): StudioWorkArtifact {
  const questionParts = [
    params.useCase ? `Use case: ${params.useCase}` : null,
    params.taskTitle ? `Task: ${params.taskTitle}` : null,
    params.taskDescription ? `Description:\n${params.taskDescription}` : null,
  ].filter(Boolean);

  return {
    question: questionParts.join('\n\n') || 'Agent run output review',
    answer: params.output?.trim() || '',
    sources: params.contextSources,
    teamId: params.teamId,
    agentId: params.agentId,
    taskId: params.taskId ?? undefined,
    agentRunId: params.agentRunId,
    teamRunId: params.teamRunId ?? undefined,
    useCase: params.useCase ?? undefined,
  };
}

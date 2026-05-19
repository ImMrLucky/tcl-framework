import type { RunnerConfig } from './config.js';
import { chatCompletion } from './model-client.js';

export interface AgentRunResult {
  summary: string;
  status: 'COMPLETED' | 'BLOCKED' | 'NEEDS_REVIEW' | 'NEEDS_HUMAN' | 'FAILED';
  taskUpdates?: Record<string, unknown>;
  contextUpdates?: Array<Record<string, unknown>>;
  proposedFiles?: Array<{ path: string; content: string; diff?: string }>;
  questions?: string[];
  risks?: string[];
  nextRecommendedAction?: string;
}

export interface AgentLoopInput {
  teamId: string;
  agentId: string;
  taskId?: string;
  userPrompt: string;
  useCase: string;
}

export async function runAgentLoop(
  _config: RunnerConfig,
  input: AgentLoopInput,
  route?: { provider: string; model: string }
): Promise<AgentRunResult> {
  const provider = route?.provider ?? 'openai';
  const model = route?.model ?? 'gpt-4o-mini';

  try {
    const chat = await chatCompletion({
      provider,
      model,
      messages: [
        {
          role: 'system',
          content: `You are an Agent Studio teammate (use case: ${input.useCase}). Reply with JSON: { "summary": string, "status": "COMPLETED"|"BLOCKED"|"NEEDS_REVIEW"|"NEEDS_HUMAN"|"FAILED", "nextRecommendedAction"?: string }`,
        },
        { role: 'user', content: input.userPrompt },
      ],
    });

    try {
      const parsed = JSON.parse(
        chat.text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
      ) as AgentRunResult;
      if (parsed.summary && parsed.status) return parsed;
    } catch {
      /* fall through */
    }

    return {
      summary: chat.text.slice(0, 1500),
      status: 'COMPLETED',
      nextRecommendedAction: 'Review output on the team board',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      summary: msg,
      status: 'FAILED',
      nextRecommendedAction: 'Check vendor keys with agent-runner-local doctor',
    };
  }
}

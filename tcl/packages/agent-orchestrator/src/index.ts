/**
 * agent-orchestrator — gateway interface for dispatching agent work.
 *
 * Pause is enforced HERE, not just in the UI. Any consumer that wants to
 * "have an agent do X" goes through `dispatch()`; if the org / team / agent
 * is paused, it returns `PAUSED` and never invokes a model.
 */

export interface PauseGate {
  orgPaused: boolean;
  teamPaused: boolean;
  agentPaused: boolean;
}

export type DispatchOutcome = 'DISPATCHED' | 'PAUSED' | 'BLOCKED_REVIEW' | 'ERROR';

export interface DispatchRequest {
  orgId: string;
  teamId: string;
  agentId: string;
  taskId: string | null;
  /** Use-case hint for model routing (e.g. 'plan' | 'code' | 'review'). */
  useCase?: string;
  prompt: string;
  /** Caller-supplied metadata persisted to the audit log. */
  metadata?: Record<string, unknown>;
}

export interface DispatchResult {
  outcome: DispatchOutcome;
  reason?: string;
  jobId?: string;
}

export interface OrchestratorGateway {
  /**
   * Look up the live pause state for the org / team / agent triple.
   * Implementations should query the DB; the no-op gateway returns false-everywhere.
   */
  getPauseGate(input: { orgId: string; teamId: string; agentId: string }): Promise<PauseGate>;

  /**
   * Attempt to dispatch a unit of agent work. Honours pause + review gates.
   */
  dispatch(req: DispatchRequest): Promise<DispatchResult>;
}

/**
 * No-op gateway — used by the MVP. Records dispatch intent in memory and
 * always returns `DISPATCHED` unless the caller explicitly hands back a paused
 * gate via the constructor.
 */
export class NoopOrchestratorGateway implements OrchestratorGateway {
  readonly dispatched: DispatchRequest[] = [];

  constructor(private readonly defaultGate: PauseGate = { orgPaused: false, teamPaused: false, agentPaused: false }) {}

  async getPauseGate(_input: { orgId: string; teamId: string; agentId: string }): Promise<PauseGate> {
    return this.defaultGate;
  }

  async dispatch(req: DispatchRequest): Promise<DispatchResult> {
    const gate = await this.getPauseGate({ orgId: req.orgId, teamId: req.teamId, agentId: req.agentId });
    if (gate.orgPaused || gate.teamPaused || gate.agentPaused) {
      return {
        outcome: 'PAUSED',
        reason: gate.orgPaused
          ? 'Org-level pause is active'
          : gate.teamPaused
          ? 'Team is paused'
          : 'Agent is paused',
      };
    }
    this.dispatched.push(req);
    return { outcome: 'DISPATCHED', jobId: `noop_${this.dispatched.length}` };
  }
}

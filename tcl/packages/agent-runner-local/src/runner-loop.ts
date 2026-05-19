import { randomUUID } from 'node:crypto';
import type { RunnerConfig } from './config.js';
import { loadConfig } from './config.js';
import {
  claimJob,
  completeJob,
  failJob,
  heartbeatRunner,
  pollJobs,
  progressJob,
  type TeamRunJob,
} from './api-client.js';
import { runJarvisTick } from './jarvis-loop.js';
import { logTeamEvent } from './board-client.js';

export interface RunnerLoopOptions {
  once?: boolean;
  signal?: AbortSignal;
}

export async function runRunnerLoop(opts: RunnerLoopOptions = {}): Promise<void> {
  const config = loadConfig();
  if (!config.runnerId) {
    throw new Error('Runner not paired. Run: agent-runner-local pair');
  }

  const runnerId = config.runnerId;
  const sessionId = randomUUID();
  const interval = config.pollIntervalMs ?? 5000;

  console.log(`Agent Runner online (${runnerId})`);
  console.log(`API: ${config.apiBaseUrl}`);
  console.log(`Poll every ${interval}ms — Ctrl+C to stop`);

  const tick = async (): Promise<void> => {
    if (opts.signal?.aborted) return;

    await heartbeatRunner(config, runnerId, {
      version: '0.1.0',
      sessionId,
    });

    const { jobs, revoked } = await pollJobs(config, runnerId);
    if (revoked) {
      console.error('Runner revoked in ProtectQA. Exiting.');
      process.exit(1);
    }
    if (!jobs.length) {
      if (opts.once) {
        console.log('No jobs in queue.');
        return;
      }
      return;
    }

    for (const job of jobs) {
      if (opts.signal?.aborted) return;
      await processJob(config, runnerId, sessionId, job);
      if (opts.once) return;
    }
  };

  if (opts.once) {
    await tick();
    return;
  }

  for (;;) {
    if (opts.signal?.aborted) break;
    try {
      await tick();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[runner] tick error:', msg);
    }
    await sleep(interval, opts.signal);
  }
}

async function processJob(
  config: RunnerConfig,
  runnerId: string,
  sessionId: string,
  job: TeamRunJob
): Promise<void> {
  if (job.status === 'PAUSED') {
    console.log(`Skip paused run ${job.id}`);
    return;
  }

  console.log(`Processing team run ${job.id} — ${job.objective.slice(0, 80)}`);

  let run = job;
  if (job.status === 'QUEUED' || !job.local_runner_id) {
    const claimed = await claimJob(config, job.id, runnerId, sessionId);
    run = claimed.run;
  }

  try {
    await logTeamEvent(config, run.team_id, {
      teamRunId: run.id,
      eventType: 'team_run.claimed',
      actorType: 'LOCAL_RUNNER',
      actorName: 'agent-runner-local',
      summary: `Local runner claimed team run`,
      jsonl: { runnerId, sessionId },
    });

    const tick = await runJarvisTick(config, run);
    const nextSteps = run.completed_steps + 1;

    await progressJob(config, run.id, {
      completedSteps: nextSteps,
      status: tick.done ? 'SUCCEEDED' : 'RUNNING',
      metadata: { lastAction: tick.action, lastSummary: tick.summary.slice(0, 500) },
    });

    if (tick.done) {
      await completeJob(config, run.id, 'SUCCEEDED', {
        lastAction: tick.action,
      });
      await logTeamEvent(config, run.team_id, {
        teamRunId: run.id,
        eventType: 'team_run.completed',
        actorType: 'JARVIS',
        actorName: 'Jarvis',
        summary: tick.summary,
        jsonl: { action: tick.action },
      });
      console.log(`Run ${run.id} completed.`);
    } else {
      console.log(`Run ${run.id} step ${nextSteps}: ${tick.action}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Run ${run.id} failed:`, msg);
    await failJob(config, run.id, msg);
    await logTeamEvent(config, run.team_id, {
      teamRunId: run.id,
      eventType: 'team_run.failed',
      actorType: 'LOCAL_RUNNER',
      summary: msg.slice(0, 500),
      jsonl: { error: msg },
    });
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

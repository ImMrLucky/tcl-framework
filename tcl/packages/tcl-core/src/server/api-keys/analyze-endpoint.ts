/**
 * API Analyze Endpoint
 * POST /api/analyze - Analysis endpoint for API key users
 */

import express from 'express';
import { getOrgContext } from '../auth-context.js';
import { planService } from '../plans/plan-service.js';
import { Capability } from '../plans/capabilities.js';
import type { ValidateInput } from '../../types.js';

// Lazy load validate function (same pattern as express.ts)
let validate: ((input: ValidateInput) => Promise<any>) | null = null;
let OpenAIAdapter: any = null;

async function loadModules() {
  if (!validate) {
    const orchestrator = await import('../../orchestrator.js');
    validate = orchestrator.validate;
  }
  if (!OpenAIAdapter) {
    try {
      const adapter = await import('../../adapters/openai_adapter.js');
      OpenAIAdapter = adapter.OpenAIAdapter;
    } catch (e) {
      // OpenAI adapter not available
    }
  }
}

export function setupAnalyzeEndpoint(app: express.Application) {
  // ============================================================================
  // POST /api/analyze - Analyze endpoint for API key users
  // ============================================================================
  app.post('/api/analyze', async (req, res) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timeout' });
      }
    }, 300000); // 5 minute timeout

    try {
      // Ensure modules are loaded
      if (!validate) {
        await loadModules();
        if (!validate) {
          clearTimeout(timeout);
          return res.status(503).json({ error: 'Service initializing, please try again' });
        }
      }

      // Get org context (must be API key auth)
      const context = await getOrgContext(req);
      
      if (!context || context.error || !context.orgId) {
        clearTimeout(timeout);
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }

      // Must be authenticated via API key (not user session)
      if (!context.apiKeyMode) {
        clearTimeout(timeout);
        return res.status(401).json({ error: 'API key authentication required' });
      }

      // Check capability based on API key mode
      const requiredCapability = context.apiKeyMode === 'PROD' 
        ? Capability.API_ACCESS_PROD 
        : Capability.API_ACCESS_SANDBOX;

      const hasCap = await planService.hasCapability(context.orgId, requiredCapability);
      if (!hasCap) {
        const planContext = await planService.getOrgPlanContext(context.orgId);
        clearTimeout(timeout);
        return res.status(403).json({
          error: 'UPGRADE_REQUIRED',
          requiredCapability: requiredCapability,
          currentPlan: planContext.tier,
          message: `API access with ${context.apiKeyMode} keys requires ${requiredCapability}. Your current plan (${planContext.tier}) does not include this capability.`,
        });
      }

      // Consume usage quota
      try {
        await planService.consumeUsage(context.orgId, 'api_calls', 1);
      } catch (usageError: any) {
        if (usageError.error === 'RATE_LIMIT') {
          clearTimeout(timeout);
          return res.status(429).json(usageError);
        }
        throw usageError;
      }

      const input = req.body as ValidateInput;

      // Validate question (required)
      if (!input.question || typeof input.question !== 'string' || input.question.trim().length === 0) {
        clearTimeout(timeout);
        return res.status(400).json({ error: 'question is required and must be a non-empty string' });
      }
      
      // Validate answer - allow empty string
      if (input.answer === undefined || input.answer === null) {
        input.answer = '';
      }
      if (typeof input.answer !== 'string') {
        input.answer = String(input.answer);
      }

      // Setup LLM adapter if available
      const apiKey = process.env.OPENAI_API_KEY;
      const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
      if (apiKey && !input.options?.llmAdapter && OpenAIAdapter) {
        input.options = input.options ?? {};
        input.options.llmAdapter = new OpenAIAdapter({ apiKey, model });
      }

      // Get plan context for mode/plan tagging
      const planContext = await planService.getOrgPlanContext(context.orgId);

      // Check file limits for manual uploads (if sources are provided)
      if (input.sources && Array.isArray(input.sources)) {
        const fileCount = input.sources.length;
        const maxFiles = planContext.limits.maxFilesPerAnalysis;
        
        if (maxFiles !== -1 && fileCount > maxFiles) {
          clearTimeout(timeout);
          return res.status(400).json({
            error: 'FILE_LIMIT_EXCEEDED',
            message: `Maximum ${maxFiles} files per analysis allowed on ${planContext.tier} plan`,
            limit: maxFiles,
            provided: fileCount,
          });
        }

        // Check file size limits
        const maxBytes = planContext.limits.maxBytesPerFile;
        if (maxBytes !== -1) {
          for (const source of input.sources) {
            if (source.text) {
              const textBytes = Buffer.byteLength(source.text, 'utf8');
              if (textBytes > maxBytes) {
                clearTimeout(timeout);
                return res.status(400).json({
                  error: 'FILE_SIZE_EXCEEDED',
                  message: `Maximum ${Math.round(maxBytes / 1024 / 1024)}MB per file allowed on ${planContext.tier} plan`,
                  limit: maxBytes,
                  provided: textBytes,
                  filename: (source as any).title || (source as any).id || 'unknown',
                });
              }
            }
          }
        }
      }

      // Consume analysis usage quota
      try {
        await planService.consumeUsage(context.orgId, 'analysis_runs', 1);
      } catch (usageError: any) {
        if (usageError.error === 'RATE_LIMIT') {
          clearTimeout(timeout);
          return res.status(429).json(usageError);
        }
        throw usageError;
      }

      console.log('API analyze request:', { orgId: context.orgId, mode: context.apiKeyMode });
      const startTime = Date.now();
      
      // Run analysis
      const out = await validate(input);
      const latency = Date.now() - startTime;

      // Add mode/plan tagging to response
      const limitations: string[] = [];
      if (planContext.tier === 'SANDBOX') {
        limitations.push('NO_LIVE_WEBHOOKS');
        limitations.push('LIMITED_API_CALLS');
        if (planContext.limits.maxFilesPerAnalysis !== -1) {
          limitations.push('LIMITED_FILES_PER_ANALYSIS');
        }
        if (planContext.limits.maxBytesPerFile !== -1) {
          limitations.push('LIMITED_FILE_SIZE');
        }
      }

      clearTimeout(timeout);
      res.json({
        ...out,
        // Add mode/plan tagging (mode matches API key mode)
        mode: context.apiKeyMode === 'PROD' ? 'prod' : 'sandbox',
        planTier: planContext.tier,
        limitations: limitations.length > 0 ? limitations : undefined,
      });
    } catch (e: any) {
      clearTimeout(timeout);
      console.error('API analyze error:', e);
      res.status(500).json({ 
        error: e?.message ?? 'unknown error',
        stack: process.env.NODE_ENV === 'development' ? e?.stack : undefined
      });
    }
  });
}


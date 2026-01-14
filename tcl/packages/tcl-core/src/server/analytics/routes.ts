/**
 * Compliance Analytics Routes
 * Provides aggregated analytics for compliance dashboard
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { getOrgContext } from '../auth-context.js';

export function setupAnalyticsRoutes(app: express.Application) {
  // ============================================================================
  // GET /api/analytics/compliance/summary - Summary KPIs
  // ============================================================================
  app.get('/api/analytics/compliance/summary', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const from = req.query.from as string;
      const to = req.query.to as string;
      const projectId = req.query.projectId as string || context.projectId;
      const env = req.query.env as string || context.env;

      // Build query
      let query = supabaseAdmin
        .from('evaluations')
        .select('id, report, created_at')
        .eq('org_id', context.orgId);

      if (projectId) {
        query = query.eq('project_id', projectId);
      }
      if (env) {
        query = query.eq('env', env);
      }
      if (from) {
        query = query.gte('created_at', from);
      }
      if (to) {
        query = query.lte('created_at', to);
      }

      const { data: evaluations, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Extract and aggregate issues
      let totalIssues = 0;
      let highCriticalCount = 0;
      let verifiedCount = 0;
      let totalRiskScore = 0;
      let riskScoreCount = 0;

      for (const eval_ of evaluations || []) {
        try {
          const report = eval_.report as any;
          if (!report) continue;
          
          // Try to get issues from various possible locations in the report
          const issues = report?.issues?.atomic || 
                        report?.issues?.grouped || 
                        report?.topIssuesV2 || 
                        report?.allIssuesV2 || 
                        report?.issues || 
                        [];
          
          if (!Array.isArray(issues)) continue;
          
          totalIssues += issues.length;

          for (const issue of issues) {
            if (!issue) continue;
            
            try {
              const severityDisplay = issue.severityDisplay || issue.severity;
              if (severityDisplay === 'high' || severityDisplay === 'critical') {
                highCriticalCount++;
              }

              const verificationLevel = issue.verification?.level;
              if (verificationLevel === 'EXTERNAL_VERIFIED') {
                verifiedCount++;
              }

              const score = issue.score ?? (issue.riskScore ?? 0) * 100;
              if (score > 0) {
                totalRiskScore += score;
                riskScoreCount++;
              }
            } catch (issueError: any) {
              console.warn(`Failed to process issue from evaluation ${eval_.id}:`, issueError?.message || issueError);
              continue;
            }
          }
        } catch (evalError: any) {
          console.warn(`Failed to process evaluation ${eval_?.id || 'unknown'}:`, evalError?.message || evalError);
          continue;
        }
      }

      const avgRiskScore = riskScoreCount > 0 ? totalRiskScore / riskScoreCount : 0;
      const verifiedPercent = totalIssues > 0 ? (verifiedCount / totalIssues) * 100 : 0;

      res.json({
        totalEvaluations: evaluations?.length || 0,
        totalIssues,
        highCriticalCount,
        verifiedPercent: Math.round(verifiedPercent * 10) / 10,
        avgRiskScore: Math.round(avgRiskScore * 10) / 10,
      });
    } catch (e: any) {
      console.error('Get compliance summary error:', e);
      console.error('Error stack:', e?.stack);
      res.status(500).json({ 
        error: e?.message ?? 'unknown error',
        details: process.env.NODE_ENV === 'development' ? e?.stack : undefined
      });
    }
  });

  // ============================================================================
  // GET /api/analytics/compliance/timeseries - Issues over time
  // ============================================================================
  app.get('/api/analytics/compliance/timeseries', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const from = req.query.from as string;
      const to = req.query.to as string;
      const bucket = (req.query.bucket as string) || 'day';
      const projectId = req.query.projectId as string || context.projectId;
      const env = req.query.env as string || context.env;

      // Build query
      let query = supabaseAdmin
        .from('evaluations')
        .select('id, report, created_at')
        .eq('org_id', context.orgId);

      if (projectId) {
        query = query.eq('project_id', projectId);
      }
      if (env) {
        query = query.eq('env', env);
      }
      if (from) {
        query = query.gte('created_at', from);
      }
      if (to) {
        query = query.lte('created_at', to);
      }

      const { data: evaluations, error } = await query.order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Group by time bucket
      const buckets = new Map<string, { low: number; medium: number; high: number; critical: number }>();

      for (const eval_ of evaluations || []) {
        try {
          const report = eval_.report as any;
          if (!report) continue;
          
          // Try to get issues from various possible locations in the report
          const issues = report?.issues?.atomic || 
                        report?.issues?.grouped || 
                        report?.topIssuesV2 || 
                        report?.allIssuesV2 || 
                        report?.issues || 
                        [];
          
          if (!Array.isArray(issues)) continue;
          
          const date = new Date(eval_.created_at);
          if (isNaN(date.getTime())) continue; // Skip invalid dates
          
          let bucketKey: string;
          if (bucket === 'week') {
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            weekStart.setHours(0, 0, 0, 0);
            bucketKey = weekStart.toISOString().split('T')[0];
          } else {
            bucketKey = date.toISOString().split('T')[0];
          }

          if (!buckets.has(bucketKey)) {
            buckets.set(bucketKey, { low: 0, medium: 0, high: 0, critical: 0 });
          }

          const bucketData = buckets.get(bucketKey)!;

          for (const issue of issues) {
            if (!issue) continue;
            
            try {
              const severityDisplay = issue.severityDisplay || issue.severity;
              if (severityDisplay === 'low') bucketData.low++;
              else if (severityDisplay === 'medium') bucketData.medium++;
              else if (severityDisplay === 'high') bucketData.high++;
              else if (severityDisplay === 'critical') bucketData.critical++;
            } catch (issueError: any) {
              console.warn(`Failed to process issue from evaluation ${eval_.id}:`, issueError?.message || issueError);
              continue;
            }
          }
        } catch (evalError: any) {
          console.warn(`Failed to process evaluation ${eval_?.id || 'unknown'}:`, evalError?.message || evalError);
          continue;
        }
      }

      // Convert to array format
      const timeseries = Array.from(buckets.entries())
        .map(([date, counts]) => ({
          date,
          ...counts,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json({ timeseries });
    } catch (e: any) {
      console.error('Get timeseries error:', e);
      console.error('Error stack:', e?.stack);
      res.status(500).json({ 
        error: e?.message ?? 'unknown error',
        details: process.env.NODE_ENV === 'development' ? e?.stack : undefined
      });
    }
  });

  // ============================================================================
  // GET /api/analytics/compliance/top-categories - Top categories
  // ============================================================================
  app.get('/api/analytics/compliance/top-categories', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const from = req.query.from as string;
      const to = req.query.to as string;
      const projectId = req.query.projectId as string || context.projectId;
      const env = req.query.env as string || context.env;

      // Build query
      let query = supabaseAdmin
        .from('evaluations')
        .select('id, report')
        .eq('org_id', context.orgId);

      if (projectId) {
        query = query.eq('project_id', projectId);
      }
      if (env) {
        query = query.eq('env', env);
      }
      if (from) {
        query = query.gte('created_at', from);
      }
      if (to) {
        query = query.lte('created_at', to);
      }

      const { data: evaluations, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Count by category
      const categoryCounts = new Map<string, number>();

      for (const eval_ of evaluations || []) {
        try {
          const report = eval_.report as any;
          if (!report) continue;
          
          // Try to get issues from various possible locations in the report
          const issues = report?.issues?.atomic || 
                        report?.issues?.grouped || 
                        report?.topIssuesV2 || 
                        report?.allIssuesV2 || 
                        report?.issues || 
                        [];
          
          if (!Array.isArray(issues)) continue;
          
          for (const issue of issues) {
            if (!issue) continue;
            
            try {
              const category = issue.category || 'other';
              categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
            } catch (issueError: any) {
              console.warn(`Failed to process issue from evaluation ${eval_.id}:`, issueError?.message || issueError);
              continue;
            }
          }
        } catch (evalError: any) {
          console.warn(`Failed to process evaluation ${eval_?.id || 'unknown'}:`, evalError?.message || evalError);
          continue;
        }
      }

      // Convert to array and sort
      const topCategories = Array.from(categoryCounts.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      res.json({ topCategories });
    } catch (e: any) {
      console.error('Get top categories error:', e);
      console.error('Error stack:', e?.stack);
      res.status(500).json({ 
        error: e?.message ?? 'unknown error',
        details: process.env.NODE_ENV === 'development' ? e?.stack : undefined
      });
    }
  });

  // ============================================================================
  // GET /api/analytics/compliance/top-types - Top issue types
  // ============================================================================
  app.get('/api/analytics/compliance/top-types', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const from = req.query.from as string;
      const to = req.query.to as string;
      const projectId = req.query.projectId as string || context.projectId;
      const env = req.query.env as string || context.env;

      // Build query
      let query = supabaseAdmin
        .from('evaluations')
        .select('id, report')
        .eq('org_id', context.orgId);

      if (projectId) {
        query = query.eq('project_id', projectId);
      }
      if (env) {
        query = query.eq('env', env);
      }
      if (from) {
        query = query.gte('created_at', from);
      }
      if (to) {
        query = query.lte('created_at', to);
      }

      const { data: evaluations, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Count by type
      const typeCounts = new Map<string, number>();

      for (const eval_ of evaluations || []) {
        try {
          const report = eval_.report as any;
          if (!report) continue;
          
          // Try to get issues from various possible locations in the report
          const issues = report?.issues?.atomic || 
                        report?.issues?.grouped || 
                        report?.topIssuesV2 || 
                        report?.allIssuesV2 || 
                        report?.issues || 
                        [];
          
          if (!Array.isArray(issues)) continue;
          
          for (const issue of issues) {
            if (!issue) continue;
            
            try {
              const type = issue.type || 'OTHER';
              typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
            } catch (issueError: any) {
              console.warn(`Failed to process issue from evaluation ${eval_.id}:`, issueError?.message || issueError);
              continue;
            }
          }
        } catch (evalError: any) {
          console.warn(`Failed to process evaluation ${eval_?.id || 'unknown'}:`, evalError?.message || evalError);
          continue;
        }
      }

      // Convert to array and sort
      const topTypes = Array.from(typeCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      res.json({ topTypes });
    } catch (e: any) {
      console.error('Get top types error:', e);
      console.error('Error stack:', e?.stack);
      res.status(500).json({ 
        error: e?.message ?? 'unknown error',
        details: process.env.NODE_ENV === 'development' ? e?.stack : undefined
      });
    }
  });

  // ============================================================================
  // GET /api/analytics/compliance/verification-coverage - Verification coverage
  // ============================================================================
  app.get('/api/analytics/compliance/verification-coverage', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const from = req.query.from as string;
      const to = req.query.to as string;
      const bucket = (req.query.bucket as string) || 'day';
      const projectId = req.query.projectId as string || context.projectId;
      const env = req.query.env as string || context.env;

      // Build query
      let query = supabaseAdmin
        .from('evaluations')
        .select('id, report, created_at')
        .eq('org_id', context.orgId);

      if (projectId) {
        query = query.eq('project_id', projectId);
      }
      if (env) {
        query = query.eq('env', env);
      }
      if (from) {
        query = query.gte('created_at', from);
      }
      if (to) {
        query = query.lte('created_at', to);
      }

      const { data: evaluations, error } = await query.order('created_at', { ascending: true });

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Group by time bucket
      const buckets = new Map<string, { externalVerified: number; transcriptOnly: number; none: number }>();

      for (const eval_ of evaluations || []) {
        try {
          const report = eval_.report as any;
          if (!report) continue;
          
          // Try to get issues from various possible locations in the report
          const issues = report?.issues?.atomic || 
                        report?.issues?.grouped || 
                        report?.topIssuesV2 || 
                        report?.allIssuesV2 || 
                        report?.issues || 
                        [];
          
          if (!Array.isArray(issues)) continue;
          
          const date = new Date(eval_.created_at);
          if (isNaN(date.getTime())) continue; // Skip invalid dates
          
          let bucketKey: string;
          if (bucket === 'week') {
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            weekStart.setHours(0, 0, 0, 0);
            bucketKey = weekStart.toISOString().split('T')[0];
          } else {
            bucketKey = date.toISOString().split('T')[0];
          }

          if (!buckets.has(bucketKey)) {
            buckets.set(bucketKey, { externalVerified: 0, transcriptOnly: 0, none: 0 });
          }

          const bucketData = buckets.get(bucketKey)!;

          for (const issue of issues) {
            if (!issue) continue;
            
            try {
              const verificationLevel = issue.verification?.level;
              if (verificationLevel === 'EXTERNAL_VERIFIED') {
                bucketData.externalVerified++;
              } else if (verificationLevel === 'TRANSCRIPT_ONLY') {
                bucketData.transcriptOnly++;
              } else {
                bucketData.none++;
              }
            } catch (issueError: any) {
              console.warn(`Failed to process issue from evaluation ${eval_.id}:`, issueError?.message || issueError);
              continue;
            }
          }
        } catch (evalError: any) {
          console.warn(`Failed to process evaluation ${eval_?.id || 'unknown'}:`, evalError?.message || evalError);
          continue;
        }
      }

      // Convert to array format
      const coverage = Array.from(buckets.entries())
        .map(([date, counts]) => ({
          date,
          ...counts,
          total: counts.externalVerified + counts.transcriptOnly + counts.none,
          verifiedPercent: counts.externalVerified + counts.transcriptOnly + counts.none > 0
            ? Math.round(((counts.externalVerified / (counts.externalVerified + counts.transcriptOnly + counts.none)) * 100) * 10) / 10
            : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json({ coverage });
    } catch (e: any) {
      console.error('Get verification coverage error:', e);
      console.error('Error stack:', e?.stack);
      res.status(500).json({ 
        error: e?.message ?? 'unknown error',
        details: process.env.NODE_ENV === 'development' ? e?.stack : undefined
      });
    }
  });

  // ============================================================================
  // GET /api/analytics/compliance/patterns - Top recurring issue patterns
  // ============================================================================
  app.get('/api/analytics/compliance/patterns', async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || 'Authorization required' });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: 'Supabase not configured' });
      }

      const from = req.query.from as string;
      const to = req.query.to as string;
      const projectId = req.query.projectId as string || context.projectId;
      const env = req.query.env as string || context.env;

      // Build query
      let query = supabaseAdmin
        .from('evaluations')
        .select('id, report')
        .eq('org_id', context.orgId);

      if (projectId) {
        query = query.eq('project_id', projectId);
      }
      if (env) {
        query = query.eq('env', env);
      }
      if (from) {
        query = query.gte('created_at', from);
      }
      if (to) {
        query = query.lte('created_at', to);
      }

      const { data: evaluations, error } = await query;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Group by pattern: type + category + normalized summary
      const patternMap = new Map<string, {
        type: string;
        category: string;
        summary: string;
        count: number;
        avgScore: number;
        totalScore: number;
        scoreCount: number;
        severityBreakdown: { low: number; medium: number; high: number; critical: number };
      }>();

      for (const eval_ of evaluations || []) {
        try {
          const report = eval_.report as any;
          if (!report) continue;
          
          // Try to get issues from various possible locations in the report
          const issues = report?.issues?.atomic || 
                        report?.issues?.grouped || 
                        report?.topIssuesV2 || 
                        report?.allIssuesV2 || 
                        report?.issues || 
                        [];
          
          if (!Array.isArray(issues)) continue;
          
          for (const issue of issues) {
            if (!issue) continue;
            
            try {
              const type = issue.type || 'OTHER';
              const category = issue.category || 'other';
              // Normalize summary: take first 50 chars, lowercase, remove special chars
              const summary = (issue.what?.issueSummary || '').toString().substring(0, 50).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
              const patternKey = `${type}|${category}|${summary}`;

              if (!patternMap.has(patternKey)) {
                patternMap.set(patternKey, {
                  type,
                  category,
                  summary: issue.what?.issueSummary || '',
                  count: 0,
                  avgScore: 0,
                  totalScore: 0,
                  scoreCount: 0,
                  severityBreakdown: { low: 0, medium: 0, high: 0, critical: 0 },
                });
              }

              const pattern = patternMap.get(patternKey)!;
              pattern.count++;

              const score = issue.score ?? (issue.riskScore ?? 0) * 100;
              if (score > 0) {
                pattern.totalScore += score;
                pattern.scoreCount++;
              }

              const severityDisplay = issue.severityDisplay || issue.severity;
              if (severityDisplay === 'low') pattern.severityBreakdown.low++;
              else if (severityDisplay === 'medium') pattern.severityBreakdown.medium++;
              else if (severityDisplay === 'high') pattern.severityBreakdown.high++;
              else if (severityDisplay === 'critical') pattern.severityBreakdown.critical++;
            } catch (issueError: any) {
              console.warn(`Failed to process issue from evaluation ${eval_.id}:`, issueError?.message || issueError);
              continue;
            }
          }
        } catch (evalError: any) {
          console.warn(`Failed to process evaluation ${eval_?.id || 'unknown'}:`, evalError?.message || evalError);
          continue;
        }
      }

      // Calculate averages and convert to array
      const patterns = Array.from(patternMap.values())
        .map(pattern => ({
          ...pattern,
          avgScore: pattern.scoreCount > 0 ? Math.round((pattern.totalScore / pattern.scoreCount) * 10) / 10 : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      res.json({ patterns });
    } catch (e: any) {
      console.error('Get patterns error:', e);
      console.error('Error stack:', e?.stack);
      res.status(500).json({ 
        error: e?.message ?? 'unknown error',
        details: process.env.NODE_ENV === 'development' ? e?.stack : undefined
      });
    }
  });
}


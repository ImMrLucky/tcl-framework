/**
 * Verification Diff
 * Compares uploaded transcript vs ASR transcript for mismatches
 */

import { supabaseAdmin } from '../supabase.js';
import { readAsset } from '../ingest/storage.js';

export interface VerificationReport {
  id: string;
  summary_json: {
    mismatchScore: number;
    entityMismatches: Array<{
      type: 'money' | 'date' | 'percentage' | 'other';
      uploaded: string;
      asr: string;
      context: string;
    }>;
    highRiskDifferences: Array<{
      uploaded: string;
      asr: string;
      context: string;
      risk: 'high' | 'medium' | 'low';
    }>;
    notes: string[];
  };
}

const MISMATCH_THRESHOLD = parseFloat(process.env.VERIFY_MISMATCH_THRESHOLD || '0.20');
const ENTITY_MISMATCH_WEIGHT = parseFloat(process.env.VERIFY_ENTITY_MISMATCH_WEIGHT || '2.0');

/**
 * Compute verification diff between uploaded and ASR transcripts
 */
export async function computeVerificationDiff(
  orgId: string,
  jobId: string,
  uploadedTranscriptAssetId: string,
  asrTranscriptAssetId: string,
  uploadedText: string,
  asrText: string
): Promise<VerificationReport> {
  // Token-level similarity (simple word-based)
  const mismatchScore = computeMismatchScore(uploadedText, asrText);

  // Entity mismatch detection
  const entityMismatches = detectEntityMismatches(uploadedText, asrText);

  // High-risk differences
  const highRiskDifferences = detectHighRiskDifferences(uploadedText, asrText);

  const summary = {
    mismatchScore,
    entityMismatches,
    highRiskDifferences,
    notes: [
      `Overall mismatch score: ${(mismatchScore * 100).toFixed(1)}%`,
      `Entity mismatches found: ${entityMismatches.length}`,
      `High-risk differences: ${highRiskDifferences.length}`,
    ],
  };

  // Store verification report
  if (!supabaseAdmin) {
    throw new Error('Database not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('verification_reports')
    .insert({
      org_id: orgId,
      job_id: jobId,
      uploaded_transcript_asset_id: uploadedTranscriptAssetId,
      asr_transcript_asset_id: asrTranscriptAssetId,
      summary_json: summary,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create verification report: ${error.message}`);
  }

  return {
    id: data.id,
    summary_json: summary,
  };
}

/**
 * Compute token-level mismatch score (0-1, higher = more mismatch)
 */
function computeMismatchScore(text1: string, text2: string): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  // Simple word overlap
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  // Jaccard distance (1 - similarity)
  const similarity = intersection.size / union.size;
  return 1 - similarity;
}

/**
 * Tokenize text into words (normalized)
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Detect entity mismatches (money, dates, percentages)
 */
function detectEntityMismatches(text1: string, text2: string): Array<{
  type: 'money' | 'date' | 'percentage' | 'other';
  uploaded: string;
  asr: string;
  context: string;
}> {
  const mismatches: Array<{
    type: 'money' | 'date' | 'percentage' | 'other';
    uploaded: string;
    asr: string;
    context: string;
  }> = [];

  // Extract entities from both texts
  const entities1 = extractEntities(text1);
  const entities2 = extractEntities(text2);

  // Find mismatches
  for (const [type, values1] of Object.entries(entities1)) {
    const values2 = entities2[type as keyof typeof entities2] || [];
    
    for (const entity1 of values1) {
      // Find closest match in text2
      const match = findClosestMatch(entity1.value, values2);
      
      if (!match || match.value !== entity1.value) {
        mismatches.push({
          type: type as any,
          uploaded: entity1.value,
          asr: match?.value || '(not found)',
          context: entity1.context,
        });
      }
    }
  }

  return mismatches.slice(0, 20); // Top 20
}

/**
 * Extract entities from text
 */
function extractEntities(text: string): {
  money: Array<{ value: string; context: string }>;
  date: Array<{ value: string; context: string }>;
  percentage: Array<{ value: string; context: string }>;
} {
  const entities = {
    money: [] as Array<{ value: string; context: string }>,
    date: [] as Array<{ value: string; context: string }>,
    percentage: [] as Array<{ value: string; context: string }>,
  };

  const words = text.split(/\s+/);
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const context = words.slice(Math.max(0, i - 3), Math.min(words.length, i + 4)).join(' ');

    // Money patterns: $123.45, 123 dollars, etc.
    if (/\$[\d,]+\.?\d*|[\d,]+\.?\d*\s*(dollars?|usd)/i.test(word)) {
      entities.money.push({ value: word, context });
    }

    // Date patterns: MM/DD/YYYY, YYYY-MM-DD, etc.
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/.test(word)) {
      entities.date.push({ value: word, context });
    }

    // Percentage patterns: 50%, 50 percent
    if (/\d+%|\d+\s*percent/i.test(word)) {
      entities.percentage.push({ value: word, context });
    }
  }

  return entities;
}

/**
 * Find closest match for a value in a list
 */
function findClosestMatch(
  value: string,
  candidates: Array<{ value: string; context: string }>
): { value: string; context: string } | null {
  if (candidates.length === 0) return null;

  // Exact match
  const exact = candidates.find(c => c.value === value);
  if (exact) return exact;

  // Fuzzy match (simple)
  const normalized = value.toLowerCase().replace(/[^\w]/g, '');
  const fuzzy = candidates.find(c => 
    c.value.toLowerCase().replace(/[^\w]/g, '') === normalized
  );
  if (fuzzy) return fuzzy;

  return null;
}

/**
 * Detect high-risk differences (key phrases, numbers, etc.)
 */
function detectHighRiskDifferences(text1: string, text2: string): Array<{
  uploaded: string;
  asr: string;
  context: string;
  risk: 'high' | 'medium' | 'low';
}> {
  const differences: Array<{
    uploaded: string;
    asr: string;
    context: string;
    risk: 'high' | 'medium' | 'low';
  }> = [];

  // Split into sentences
  const sentences1 = text1.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const sentences2 = text2.split(/[.!?]+/).filter(s => s.trim().length > 10);

  // Compare sentences
  for (let i = 0; i < Math.min(sentences1.length, sentences2.length); i++) {
    const s1 = sentences1[i].trim();
    const s2 = sentences2[i].trim();

    if (s1 !== s2) {
      // Check if it's a high-risk difference (contains numbers, money, etc.)
      const hasNumbers = /\d/.test(s1) || /\d/.test(s2);
      const hasMoney = /\$|dollar|usd/i.test(s1) || /\$|dollar|usd/i.test(s2);
      
      const risk = hasMoney ? 'high' : hasNumbers ? 'medium' : 'low';

      differences.push({
        uploaded: s1.substring(0, 100),
        asr: s2.substring(0, 100),
        context: s1.substring(0, 50) + '...',
        risk,
      });
    }
  }

  return differences.slice(0, 10); // Top 10
}


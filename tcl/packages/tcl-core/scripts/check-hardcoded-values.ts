#!/usr/bin/env node
/**
 * Hard-Coded Values Checker
 * 
 * Build-time rule to prevent hard-coded thresholds and clamps in calculation paths.
 * 
 * Checks for:
 * - Hard-coded threshold values (0.65, 0.7, 0.6, etc.) in orchestrator outputs
 * - Hard-coded clamps like Math.min(config.thresholds.grounding, 0.4)
 * - supportThreshold:, contradictionThreshold:, groundingThreshold: in outputs
 * 
 * Usage: npm run check:hardcoded
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

interface Violation {
  file: string;
  line: number;
  column: number;
  pattern: string;
  message: string;
}

const VIOLATIONS: Violation[] = [];

// Patterns to check for hard-coded values in calculation paths
const HARDCODED_PATTERNS = [
  // Hard-coded thresholds in orchestrator outputs
  {
    pattern: /supportThreshold:\s*(0\.(6[0-9]|7[0-9]|8[0-9]|9[0-9])|0\.65|0\.70|0\.60)/,
    message: 'Hard-coded supportThreshold found. Use config.thresholds.support instead.',
    excludeFiles: ['template-config.ts', 'check-hardcoded-values.ts'],
  },
  {
    pattern: /contradictionThreshold:\s*(0\.(5[5-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9])|0\.65|0\.70|0\.60)/,
    message: 'Hard-coded contradictionThreshold found. Use config.thresholds.contradiction instead.',
    excludeFiles: ['template-config.ts', 'check-hardcoded-values.ts'],
  },
  {
    pattern: /groundingThreshold:\s*(0\.(2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9])|0\.60|0\.65|0\.70)/,
    message: 'Hard-coded groundingThreshold found. Use config.thresholds.grounding instead.',
    excludeFiles: ['template-config.ts', 'check-hardcoded-values.ts'],
  },
  // Hard-coded clamps in calculation paths
  {
    pattern: /Math\.min\(config\.thresholds\.\w+,\s*0\.\d+\)/,
    message: 'Hard-coded clamp found. Use config-based clamping instead (e.g., config.thresholds.groundingEffective ?? config.thresholds.grounding).',
    excludeFiles: ['template-config.ts', 'check-hardcoded-values.ts'],
  },
  {
    pattern: /Math\.max\(config\.thresholds\.\w+,\s*0\.\d+\)/,
    message: 'Hard-coded clamp found. Use config-based clamping instead.',
    excludeFiles: ['template-config.ts', 'check-hardcoded-values.ts'],
  },
  // Common hard-coded threshold values in calculation paths (not in config files)
  {
    pattern: /(?:score|threshold|weight)\s*[=:]\s*(0\.65|0\.70|0\.60|0\.75|0\.80)\s*[;,\n]/,
    message: 'Hard-coded threshold value found. Use config values instead.',
    excludeFiles: ['template-config.ts', 'check-hardcoded-values.ts', '*.test.ts', '*.spec.ts'],
    excludeComments: true,
  },
  // Hard-coded magic numbers in scoring calculations
  {
    pattern: /\*\s*(0\.65|0\.70|0\.60|0\.75|0\.80)\s*[+\-*\/]/,
    message: 'Hard-coded weight/threshold in calculation. Use config values instead.',
    excludeFiles: ['template-config.ts', 'check-hardcoded-values.ts', '*.test.ts', '*.spec.ts'],
    excludeComments: true,
  },
];

// Files/directories to exclude
const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  '.git',
  'scripts',
  '__tests__',
  'test',
  'tests',
];

const EXCLUDE_FILES = [
  'check-hardcoded-values.ts',
  'template-config.ts', // Config files are allowed to have thresholds
];

function shouldExcludeFile(filePath: string, pattern: typeof HARDCODED_PATTERNS[0]): boolean {
  const fileName = filePath.split('/').pop() || '';
  
  // Check exclude files
  if (EXCLUDE_FILES.some(ex => fileName.includes(ex))) {
    return true;
  }
  
  // Check pattern-specific excludes
  if (pattern.excludeFiles?.some(ex => fileName.includes(ex))) {
    return true;
  }
  
  // Exclude test files if pattern says so
  if (pattern.excludeComments && (fileName.includes('.test.') || fileName.includes('.spec.'))) {
    return true;
  }
  
  return false;
}

function checkFile(filePath: string): void {
  if (shouldExcludeFile(filePath, HARDCODED_PATTERNS[0])) {
    return;
  }
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      
      // Skip comments if pattern says so
      const isComment = line.trim().startsWith('//') || line.trim().startsWith('*');
      
      for (const pattern of HARDCODED_PATTERNS) {
        if (shouldExcludeFile(filePath, pattern)) {
          continue;
        }
        
        if (pattern.excludeComments && isComment) {
          continue;
        }
        
        const match = line.match(pattern.pattern);
        if (match) {
          const column = (match.index || 0) + 1;
          VIOLATIONS.push({
            file: filePath,
            line: lineNum,
            column,
            pattern: pattern.pattern.toString(),
            message: pattern.message,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
  }
}

function walkDirectory(dir: string, baseDir: string = dir): void {
  try {
    const entries = readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (!EXCLUDE_DIRS.includes(entry)) {
          walkDirectory(fullPath, baseDir);
        }
      } else if (stat.isFile() && entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        checkFile(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
}

function main(): void {
  const srcDir = join(__dirname, '..', 'src');
  const startTime = Date.now();
  
  console.log('🔍 Checking for hard-coded thresholds and clamps...\n');
  console.log(`Scanning: ${srcDir}\n`);
  
  walkDirectory(srcDir);
  
  const duration = Date.now() - startTime;
  
  if (VIOLATIONS.length === 0) {
    console.log('✅ No hard-coded values found!');
    console.log(`   Scanned in ${duration}ms\n`);
    process.exit(0);
  } else {
    console.error(`❌ Found ${VIOLATIONS.length} violation(s):\n`);
    
    // Group by file
    const byFile = new Map<string, Violation[]>();
    for (const violation of VIOLATIONS) {
      const relPath = relative(process.cwd(), violation.file);
      if (!byFile.has(relPath)) {
        byFile.set(relPath, []);
      }
      byFile.get(relPath)!.push(violation);
    }
    
    // Print violations
    for (const [file, violations] of byFile.entries()) {
      console.error(`📄 ${file}:`);
      for (const violation of violations) {
        console.error(`   Line ${violation.line}, Col ${violation.column}: ${violation.message}`);
        console.error(`   Pattern: ${violation.pattern}`);
      }
      console.error('');
    }
    
    console.error(`\n💡 Fix: Replace hard-coded values with config-based values from template-config.ts`);
    console.error(`   Scanned in ${duration}ms\n`);
    process.exit(1);
  }
}

main();


/**
 * Slot Registry Loader
 * 
 * Loads canonical slot definitions from JSON config files.
 * Provides global base slots + template-specific overlays.
 * 
 * Supports both dev (src/config) and prod (dist/config) paths.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SubjectSlot } from './types.js';
import { SlotLexiconEntry } from './template-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// TYPES
// =============================================================================

export interface SlotMeta {
  edgeEligibility: 'HARD' | 'SOFT' | 'NONE';
  family: string;
}

export interface GlobalSlotRegistry {
  version: string;
  globalLexicon: Record<string, SlotLexiconEntry>;
  slotMeta: Record<string, SlotMeta>;
  equivalences: string[][];
}

export interface TemplateSlotRegistry {
  version: string;
  templates: Record<string, {
    lexiconAdditions?: Record<string, SlotLexiconEntry>;
    slotMetaAdditions?: Record<string, SlotMeta>;
  }>;
}

// =============================================================================
// CONFIG LOADING (with dev/prod path resolution)
// =============================================================================

function getConfigPath(filename: string): string {
  // In production (compiled), __dirname is dist/graph, so config is at dist/config
  // In development (ts-node), __dirname is src/graph, so config is at src/config
  // In Docker, files might be at /app/config or /app/dist/config
  
  const pathsToTry = [
    // 1. dist/config relative to compiled code (production - most common)
    join(__dirname, '../../config', filename),
    // 2. dist/config from working directory
    join(process.cwd(), 'dist', 'config', filename),
    // 3. config from working directory (Docker - files at /app/config)
    join(process.cwd(), 'config', filename),
    // 4. src/config relative to compiled code (fallback)
    join(__dirname, '../../config', filename),
    // 5. src/config from working directory
    join(process.cwd(), 'src', 'config', filename),
  ];
  
  for (const pathToTry of pathsToTry) {
    if (existsSync(pathToTry)) {
      return pathToTry;
    }
  }
  
  // If none found, return the most likely path and let the error happen with a clear message
  const mostLikelyPath = join(process.cwd(), 'dist', 'config', filename);
  console.error(`[SlotRegistry] Config file not found: ${filename}`);
  console.error(`[SlotRegistry] Tried paths:`, pathsToTry);
  console.error(`[SlotRegistry] __dirname: ${__dirname}`);
  console.error(`[SlotRegistry] process.cwd(): ${process.cwd()}`);
  return mostLikelyPath;
}

let cachedGlobalRegistry: GlobalSlotRegistry | null = null;
let cachedTemplateRegistry: TemplateSlotRegistry | null = null;
let synonymIndex: Map<string, SlotLexiconEntry> | null = null;

function loadGlobalRegistry(): GlobalSlotRegistry {
  if (!cachedGlobalRegistry) {
    const path = getConfigPath('slot-registry.global.json');
    if (!existsSync(path)) {
      throw new Error(`Slot registry file not found: ${path}. Please ensure the file exists in dist/config/ or src/config/. Current working directory: ${process.cwd()}, __dirname: ${__dirname}`);
    }
    const content = readFileSync(path, 'utf-8');
    cachedGlobalRegistry = JSON.parse(content) as GlobalSlotRegistry;
    
    // Build synonym index
    synonymIndex = new Map();
    for (const [key, entry] of Object.entries(cachedGlobalRegistry.globalLexicon)) {
      const normalizedKey = key.toLowerCase();
      synonymIndex.set(normalizedKey, entry);
      for (const synonym of entry.synonyms) {
        synonymIndex.set(synonym.toLowerCase(), entry);
      }
    }
  }
  return cachedGlobalRegistry;
}

function loadTemplateRegistry(): TemplateSlotRegistry {
  if (!cachedTemplateRegistry) {
    const path = getConfigPath('slot-registry.templates.json');
    if (!existsSync(path)) {
      throw new Error(`Slot registry template file not found: ${path}. Please ensure the file exists in dist/config/ or src/config/. Current working directory: ${process.cwd()}, __dirname: ${__dirname}`);
    }
    const content = readFileSync(path, 'utf-8');
    cachedTemplateRegistry = JSON.parse(content) as TemplateSlotRegistry;
  }
  return cachedTemplateRegistry;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get registry version
 */
export function getSlotRegistryVersion(): string {
  return loadGlobalRegistry().version;
}

/**
 * Get global slot lexicon (cached, with synonym index)
 */
export function getGlobalSlotLexicon(): Record<string, SlotLexiconEntry> {
  return loadGlobalRegistry().globalLexicon;
}

/**
 * Get template-specific lexicon additions
 */
export function getTemplateSlotLexicon(templateId: string): Record<string, SlotLexiconEntry> {
  const templateRegistry = loadTemplateRegistry();
  const template = templateRegistry.templates[templateId];
  if (!template || !template.lexiconAdditions) {
    return {};
  }
  return template.lexiconAdditions;
}

/**
 * Get slot metadata (edge eligibility + family)
 */
export function getSlotMeta(slotType: string, entityKey: string): SlotMeta {
  const globalRegistry = loadGlobalRegistry();
  const slotKey = `${slotType}:${entityKey}`;
  
  // Check global meta first
  if (globalRegistry.slotMeta[slotKey]) {
    return globalRegistry.slotMeta[slotKey];
  }
  
  // Check template-specific meta (requires templateId context, so we'll need to pass it)
  // For now, return default
  return {
    edgeEligibility: 'NONE',
    family: 'misc'
  };
}

/**
 * Get slot metadata with template context
 */
export function getSlotMetaWithTemplate(slotType: string, entityKey: string, templateId?: string): SlotMeta {
  const globalRegistry = loadGlobalRegistry();
  const slotKey = `${slotType}:${entityKey}`;
  
  // Check global meta first
  if (globalRegistry.slotMeta[slotKey]) {
    return globalRegistry.slotMeta[slotKey];
  }
  
  // Check template-specific meta
  if (templateId) {
    const templateRegistry = loadTemplateRegistry();
    const template = templateRegistry.templates[templateId];
    if (template?.slotMetaAdditions?.[slotKey]) {
      return template.slotMetaAdditions[slotKey];
    }
  }
  
  // Default for misc/unclassified
  if (slotType === 'misc' && entityKey === 'unclassified') {
    return {
      edgeEligibility: 'NONE',
      family: 'misc'
    };
  }
  
  // Default for unknown slots
  return {
    edgeEligibility: 'NONE',
    family: 'misc'
  };
}

/**
 * Check if slot is HARD eligible (can create contradictions)
 */
export function isHardSlot(slotType: string, entityKey: string, templateId?: string): boolean {
  const meta = getSlotMetaWithTemplate(slotType, entityKey, templateId);
  return meta.edgeEligibility === 'HARD';
}

/**
 * Check if two slots are equivalent (via registry equivalences)
 */
export function areSlotsEquivalent(a: SubjectSlot, b: SubjectSlot): boolean {
  const globalRegistry = loadGlobalRegistry();
  const keyA = `${a.slotType}:${a.entityKey}`;
  const keyB = `${b.slotType}:${b.entityKey}`;
  
  // Direct match
  if (keyA === keyB) {
    return true;
  }
  
  // Check equivalences
  for (const equivalence of globalRegistry.equivalences) {
    if ((equivalence[0] === keyA && equivalence[1] === keyB) ||
        (equivalence[0] === keyB && equivalence[1] === keyA)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Look up lexicon entry by synonym (case-insensitive)
 */
export function lookupLexiconBySynonym(phrase: string): SlotLexiconEntry | null {
  if (!synonymIndex) {
    loadGlobalRegistry(); // This builds the synonym index
  }
  
  const normalized = phrase.toLowerCase();
  return synonymIndex?.get(normalized) || null;
}

/**
 * Merge global + template lexicons
 */
export function getMergedLexicon(templateId?: string): Record<string, SlotLexiconEntry> {
  const global = getGlobalSlotLexicon();
  if (!templateId) {
    return global;
  }
  
  const template = getTemplateSlotLexicon(templateId);
  // Template additions override global on collision
  return { ...global, ...template };
}


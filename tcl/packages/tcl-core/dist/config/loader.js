/**
 * Config Loader - Single source of truth for all thresholds, weights, templates
 *
 * NO HARD-CODED VALUES - everything comes from config files.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load JSON configs at runtime (Node.js ESM requires import assertions which TypeScript doesn't support with current module setting)
const scoringConfig = JSON.parse(readFileSync(join(__dirname, 'scoring.json'), 'utf-8'));
const templatesConfig = JSON.parse(readFileSync(join(__dirname, 'templates.json'), 'utf-8'));
const taxonomyConfig = JSON.parse(readFileSync(join(__dirname, 'taxonomy.json'), 'utf-8'));
let cachedScoring = null;
let cachedTemplates = null;
let cachedTaxonomy = null;
/**
 * Get scoring configuration (cached)
 */
export function getScoringConfig() {
    if (!cachedScoring) {
        cachedScoring = scoringConfig;
    }
    return cachedScoring;
}
/**
 * Get templates configuration (cached)
 */
export function getTemplatesConfig() {
    if (!cachedTemplates) {
        cachedTemplates = templatesConfig;
    }
    return cachedTemplates;
}
/**
 * Get taxonomy configuration (cached)
 */
export function getTaxonomyConfig() {
    if (!cachedTaxonomy) {
        cachedTaxonomy = taxonomyConfig;
    }
    return cachedTaxonomy;
}
/**
 * Compute hash of config bundle for reproducibility
 */
export function computeConfigHash() {
    const configBundle = JSON.stringify({
        scoring: scoringConfig,
        templates: templatesConfig,
        taxonomy: taxonomyConfig
    });
    return createHash('sha256').update(configBundle).digest('hex').substring(0, 16);
}
/**
 * Template string substitution
 */
export function renderTemplate(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }
    return result;
}

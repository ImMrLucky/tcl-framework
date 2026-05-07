/**
 * Domain Pack
 *
 * A domain pack is a self-contained ruleset for a particular business domain
 * (final-expense insurance, AI chat bots, telco, lending, healthcare ...).
 *
 * The orchestrator loads one or more packs per run. A pack contributes:
 *  - High-stakes vocabulary (used by claim classification)
 *  - Compliance rules (regex + severity + saferVersion + tags)
 *  - Required disclosures (a topic that demands a follow-up qualifier)
 *  - Forbidden phrases (auto-critical regardless of context)
 *
 * Adding a new vertical = one new TypeScript file. No engine changes required.
 */
export {};

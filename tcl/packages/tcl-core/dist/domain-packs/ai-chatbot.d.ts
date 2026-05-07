import type { DomainPack } from "./types.js";
/**
 * AI Chat Bot domain pack.
 *
 * Treats the bot as the "agent" role. Catches the most common AI failure modes:
 *  - Fabricated capability / authority claims
 *  - Persona drift (claiming to be human, claiming to remember sessions, etc.)
 *  - Unverified factual confidence
 *  - Missing safety/compliance disclosures (medical, legal, financial advice)
 *  - Privacy overreach
 */
export declare const aiChatbotPack: DomainPack;

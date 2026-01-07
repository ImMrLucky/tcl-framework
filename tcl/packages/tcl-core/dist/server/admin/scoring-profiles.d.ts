/**
 * Scoring Profiles Routes
 * Admin-only routes for managing scoring configuration profiles
 */
import express from 'express';
/**
 * Compute config hash from config bundle
 */
export declare function computeConfigHash(riskRankingConfig: any, issueScoringConfig: any): string;
/**
 * Get active scoring profile for an org
 */
export declare function getActiveScoringProfile(orgId: string): Promise<{
    riskRankingConfig: any;
    issueScoringConfig: any;
    configHash: string;
} | null>;
export declare function setupScoringProfilesRoutes(app: express.Application): void;

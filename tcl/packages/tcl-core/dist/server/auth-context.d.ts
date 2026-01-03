import express from "express";
export interface OrgContext {
    orgId: string;
    projectId: string;
    env: string;
    userId?: string;
    role?: string;
    error?: string;
}
/**
 * Extract org/project/env from request (API key or user session JWT)
 */
export declare function getOrgContext(req: express.Request): Promise<OrgContext | null>;

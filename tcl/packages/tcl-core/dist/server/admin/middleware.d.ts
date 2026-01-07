/**
 * Admin/Superuser Middleware
 * Provides guards and helpers for admin functionality
 */
import express from 'express';
export interface AdminContext {
    userId: string;
    role: 'USER' | 'SUPERUSER';
    isSuperuser: boolean;
}
/**
 * Middleware to require superuser access
 * Returns 403 if user is not a superuser
 */
export declare function requireSuperuser(req: express.Request, res: express.Response, next: express.NextFunction): void;
/**
 * Get admin context for the current user
 */
export declare function getAdminContext(req: express.Request): Promise<AdminContext | null>;
/**
 * Assert that an organization is an internal test org
 * Throws error if not internal or if attempting in production without explicit allow
 */
export declare function assertInternalTestOrg(orgId: string): Promise<void>;
/**
 * Log an admin action to the audit log
 */
export declare function logAdminAction(actorUserId: string, action: string, targetOrgId?: string | null, metadata?: Record<string, any> | null): Promise<void>;

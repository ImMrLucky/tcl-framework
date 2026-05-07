/**
 * Permission Middleware
 * Enforces role-based permissions on API endpoints
 */
import { Request, Response, NextFunction } from 'express';
import { type Permission } from './permission-service.js';
/**
 * Require a specific permission
 */
export declare function requirePermission(permission: Permission): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Require one of multiple permissions (OR logic)
 */
export declare function requireAnyPermission(...permissions: Permission[]): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Require all of multiple permissions (AND logic)
 */
export declare function requireAllPermissions(...permissions: Permission[]): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;

/**
 * Dev-Only Superuser Auto-Grant
 * Automatically grants SUPERUSER role to allowlisted emails/domains in dev/staging
 * Must be explicitly enabled in production via env var
 */
/**
 * Check if user should be auto-granted SUPERUSER role
 * Returns true if user should be granted, false otherwise
 */
export declare function maybeGrantSuperuser(userId: string, email: string): Promise<boolean>;

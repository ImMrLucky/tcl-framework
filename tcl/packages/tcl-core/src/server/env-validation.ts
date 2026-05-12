/**
 * Startup checks for server-side secrets. Never log secret values.
 * In production, Supabase is required for auth/DB. Local /validate-only dev may omit service role.
 */

function isProduction(): boolean {
  return (process.env.NODE_ENV || "").toLowerCase() === "production";
}

export function assertCoreServerEnv(): void {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL?.trim()) missing.push("SUPABASE_URL");
  if (isProduction() && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (missing.length === 0) return;
  const msg = `[env] Missing required variables: ${missing.join(", ")}. Copy packages/tcl-core/.env.example to .env and set values (service role only on server — never in Angular).`;
  if (isProduction()) {
    throw new Error(msg);
  }
  console.warn(msg);
}

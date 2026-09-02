import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";

/**
 * Better Auth on Workers + D1. `env.DB` is auto-detected as a D1 binding (built-in dialect since 1.5),
 * so no adapter package is needed. Module scope is fine because `cloudflare:workers` exposes env statically.
 */
export const auth = betterAuth({
  database: env.DB,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL || undefined,
  trustedOrigins: ["http://localhost:5173", "http://localhost:8787", ...(env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : [])],
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
});

export type Session = typeof auth.$Infer.Session;

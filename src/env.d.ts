// Secrets are not part of wrangler.jsonc, so declare them here; merges with the generated `Env`.
interface Env {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  OPENROUTER_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  LLM_PROVIDER?: "openrouter" | "anthropic";
  /** Optional: when set, sign-up requires this code (header x-invite-code). */
  INVITE_CODE?: string;
}

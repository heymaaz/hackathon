import { createAuthClient } from "better-auth/client"

// Same-origin in production (served by the Worker); Vite proxies /api in dev.
export const authClient = createAuthClient({ baseURL: window.location.origin })

import { handlers } from "@/auth";

/**
 * Auth.js v5 route handler.
 * Handles all /api/auth/* routes:
 *   GET  /api/auth/session
 *   GET  /api/auth/csrf
 *   GET  /api/auth/providers
 *   GET  /api/auth/callback/:provider
 *   POST /api/auth/signin/:provider
 *   POST /api/auth/signout
 */
export const { GET, POST } = handlers;

import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  /**
   * Extend the built-in Session type to include custom fields.
   * These are populated via the `session` callback in auth.ts.
   */
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }

  /**
   * Extend the built-in User type returned from the `authorize` callback
   * and OAuth providers.
   */
  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  /**
   * Extend the built-in JWT type to persist custom fields between requests.
   * These are populated via the `jwt` callback in auth.ts.
   */
  interface JWT extends DefaultJWT {
    id: string;
    role: string;
  }
}

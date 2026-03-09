import { auth } from "@/auth";
import { redirect } from "next/navigation";

/**
 * Reusable RBAC guards for Server Components and Server Actions.
 */

/**
 * Require an authenticated session. Redirects to /login if not authenticated.
 * Returns the session for use in the calling component.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Require a specific role. Returns 403-like result if role doesn't match.
 * Usage: const session = await requireRole("admin");
 */
export async function requireRole(role: string) {
  const session = await requireAuth();
  if (session.user?.role !== role) {
    throw new Error(`Forbidden: requires role "${role}"`);
  }
  return session;
}

/**
 * Check if the current user has a given role without redirecting.
 * Useful for conditional rendering inside authenticated pages.
 */
export async function hasRole(role: string): Promise<boolean> {
  const session = await auth();
  return session?.user?.role === role;
}

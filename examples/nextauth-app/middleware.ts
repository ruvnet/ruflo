import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware for route protection using Auth.js v5.
 *
 * Public routes are accessible without authentication.
 * Protected routes redirect unauthenticated users to /login.
 * Admin routes additionally require the "admin" role.
 */

const PUBLIC_ROUTES = ["/", "/login", "/api/auth"];
const ADMIN_ROUTES = ["/admin"];

function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

function isAdmin(pathname: string): boolean {
  return ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/")
  );
}

export default auth(function middleware(req: NextRequest & { auth: Awaited<ReturnType<typeof auth>> }) {
  const { pathname } = req.nextUrl;
  const session = (req as any).auth;

  // Allow public routes unconditionally
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login
  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only routes require the "admin" role
  if (isAdmin(pathname) && session.user?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.next();
});

export const config = {
  /**
   * Run middleware on all routes except static assets, images, and favicons.
   * Adjust the matcher to match your route structure.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

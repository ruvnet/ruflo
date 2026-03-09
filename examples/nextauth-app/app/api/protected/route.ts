import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Protected API route example.
 * Returns 401 for unauthenticated requests and 403 for non-admin users on
 * admin-only resources.
 */
export async function GET() {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    message: "This is a protected resource.",
    user: {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
    },
  });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  return NextResponse.json({ message: "Admin action completed.", data: body });
}

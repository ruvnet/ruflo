import { auth } from "@/auth";
import { redirect } from "next/navigation";

/**
 * Admin-only page — requires the "admin" role.
 * Middleware blocks non-admin users at the edge (returns 403).
 * This component also verifies the role for defence in depth.
 */
export default async function AdminPage() {
  const session = await auth();

  if (!session) {
    redirect("/login?callbackUrl=/admin");
  }

  if (session.user?.role !== "admin") {
    return (
      <main style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>403 — Forbidden</h1>
        <p>You do not have permission to view this page.</p>
        <a href="/dashboard">Back to Dashboard</a>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Admin Panel</h1>
      <p>
        Signed in as admin: <strong>{session.user?.email}</strong>
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Admin Actions</h2>
        <ul>
          <li>Manage users</li>
          <li>View audit logs</li>
          <li>Configure system settings</li>
        </ul>
      </section>
    </main>
  );
}

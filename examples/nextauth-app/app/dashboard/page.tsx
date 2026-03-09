import { auth } from "@/auth";
import { redirect } from "next/navigation";

/**
 * Protected dashboard page — only accessible to authenticated users.
 * Unauthenticated users are redirected to /login by middleware, but we
 * also check here as a defence-in-depth measure for direct Server Component
 * access (e.g. RSC calls bypassing middleware).
 */
export default async function DashboardPage() {
  const session = await auth();

  if (!session) {
    redirect("/login?callbackUrl=/dashboard");
  }

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Dashboard</h1>
      <p>Welcome back, <strong>{session.user?.name ?? session.user?.email}</strong>!</p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Your Session</h2>
        <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: "4px", overflow: "auto" }}>
          {JSON.stringify(
            {
              id: session.user?.id,
              email: session.user?.email,
              name: session.user?.name,
              role: session.user?.role,
              image: session.user?.image,
            },
            null,
            2
          )}
        </pre>
      </section>

      {session.user?.role === "admin" && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Admin Tools</h2>
          <p>
            You have admin access. Visit the{" "}
            <a href="/admin">Admin Panel</a>.
          </p>
        </section>
      )}
    </main>
  );
}

import { auth } from "@/auth";
import { signOut } from "@/auth";
import Link from "next/link";

/**
 * Public home page — visible to all users.
 * Reads the session server-side to conditionally render nav items.
 */
export default async function HomePage() {
  const session = await auth();

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>NextAuth.js Example</h1>
      <p>Auth.js v5 with Credentials, GitHub, and Google providers.</p>

      {session ? (
        <div>
          <p>
            Signed in as <strong>{session.user?.email}</strong> (role:{" "}
            <strong>{session.user?.role}</strong>)
          </p>

          <nav style={{ display: "flex", gap: "1rem", margin: "1rem 0" }}>
            <Link href="/dashboard">Dashboard</Link>
            {session.user?.role === "admin" && <Link href="/admin">Admin Panel</Link>}
          </nav>

          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit">Sign out</button>
          </form>
        </div>
      ) : (
        <div>
          <p>You are not signed in.</p>
          <Link href="/login">
            <button>Sign in</button>
          </Link>
        </div>
      )}
    </main>
  );
}

import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

/**
 * Login page with:
 * - Email/password credentials form (Server Action)
 * - GitHub OAuth button
 * - Google OAuth button
 * - Error display for failed login attempts
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { callbackUrl, error } = await searchParams;
  const destination = callbackUrl ?? "/dashboard";

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 400, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Sign In</h1>

      {error && (
        <div style={{ color: "red", marginBottom: "1rem" }}>
          {error === "CredentialsSignin"
            ? "Invalid email or password."
            : "An error occurred. Please try again."}
        </div>
      )}

      {/* Credentials form */}
      <form
        action={async (formData: FormData) => {
          "use server";
          try {
            await signIn("credentials", {
              email: formData.get("email"),
              password: formData.get("password"),
              redirectTo: destination,
            });
          } catch (err) {
            if (err instanceof AuthError) {
              redirect(`/login?error=${err.type}&callbackUrl=${destination}`);
            }
            throw err;
          }
        }}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}
      >
        <label>
          Email
          <input
            type="email"
            name="email"
            required
            placeholder="user@example.com"
            style={{ display: "block", width: "100%", padding: "0.4rem", marginTop: "0.25rem" }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            placeholder="••••••••"
            style={{ display: "block", width: "100%", padding: "0.4rem", marginTop: "0.25rem" }}
          />
        </label>
        <button type="submit" style={{ padding: "0.5rem", cursor: "pointer" }}>
          Sign in with Email
        </button>
      </form>

      <hr />

      {/* GitHub OAuth */}
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: destination });
        }}
        style={{ margin: "1rem 0" }}
      >
        <button type="submit" style={{ width: "100%", padding: "0.5rem", cursor: "pointer" }}>
          Sign in with GitHub
        </button>
      </form>

      {/* Google OAuth */}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: destination });
        }}
      >
        <button type="submit" style={{ width: "100%", padding: "0.5rem", cursor: "pointer" }}>
          Sign in with Google
        </button>
      </form>
    </main>
  );
}

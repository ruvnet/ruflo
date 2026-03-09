import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";

export const metadata: Metadata = {
  title: "NextAuth.js Example",
  description: "Auth.js v5 with credentials and OAuth providers",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="en">
      <body>
        {/*
          SessionProvider makes session data available to Client Components via
          useSession(). The initial session is passed from the Server Component
          to avoid a client-side fetch on first render.
        */}
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}

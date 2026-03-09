import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { NextAuthConfig } from "next-auth";

/**
 * Mock user database — replace with a real DB adapter (e.g. Prisma, Drizzle).
 * In production use @auth/prisma-adapter or @auth/drizzle-adapter.
 */
const USERS: { id: string; email: string; passwordHash: string; role: "user" | "admin" }[] = [
  {
    id: "1",
    email: "admin@example.com",
    // bcrypt hash of "password123"
    passwordHash: "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCkQJnO.V7Z1M5c1VL5uqjS",
    role: "admin",
  },
  {
    id: "2",
    email: "user@example.com",
    // bcrypt hash of "password123"
    passwordHash: "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCkQJnO.V7Z1M5c1VL5uqjS",
    role: "user",
  },
];

export const authConfig: NextAuthConfig = {
  providers: [
    /**
     * GitHub OAuth provider.
     * Set AUTH_GITHUB_ID and AUTH_GITHUB_SECRET in .env.local.
     * GitHub OAuth app callback URL: /api/auth/callback/github
     */
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),

    /**
     * Google OAuth provider.
     * Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in .env.local.
     * Google OAuth consent screen callback URL: /api/auth/callback/google
     */
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),

    /**
     * Credentials provider for email/password login.
     * Validates against hashed passwords with bcrypt.
     */
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = USERS.find((u) => u.email === email);
        if (!user) return null;

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) return null;

        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],

  callbacks: {
    /**
     * Enrich the JWT token with custom fields (e.g. role).
     * Called whenever a token is created or refreshed.
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "user";
      }
      return token;
    },

    /**
     * Expose custom JWT fields on the session object.
     * Called whenever session data is read in Server/Client Components.
     */
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

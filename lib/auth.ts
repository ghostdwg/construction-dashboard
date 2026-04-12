// Auth Wall — Auth.js v5 configuration
//
// Credentials provider (email + password) with JWT session strategy.
// The PrismaAdapter is included for future OAuth provider support (Microsoft,
// Google) but is not required for Credentials-only auth.
//
// Custom fields on the session:
//   - user.id (string)
//   - user.role ("admin" | "estimator" | "pm")
//
// AUTH_DISABLED=true in .env.local bypasses authentication entirely —
// every request gets a fake admin session. This is the solo-dev escape hatch.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = String(credentials.email).toLowerCase().trim();
        const password = String(credentials.password);

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.hashedPassword) return null;

        const valid = await bcrypt.compare(password, user.hashedPassword);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, user object is available — persist id + role to JWT
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "estimator";
      }
      return token;
    },
    async session({ session, token }) {
      // Expose id + role on the client-side session object
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
});

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "./auth.config";
import { logActivity } from "@/lib/activity";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase().trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        // Sign-in is the canonical "the user used the app" event —
        // drives the "Last active" header on the Settings page even
        // when the session hasn't done any writes yet.
        await logActivity({
          userId: user.id,
          kind: "auth.signin",
          summary: "Signed in",
        });

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});

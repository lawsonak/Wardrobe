import type { NextAuthConfig } from "next-auth";

// Edge-safe config (no Node-only deps like bcrypt/Prisma).
// The full credentials provider lives in auth.ts and runs on Node only.
// Self-hosted on a LAN over HTTP — no HTTPS, no public URL.
// Set USE_SECURE_COOKIES=true if you front this with HTTPS (reverse proxy etc).
const useSecureCookies = process.env.USE_SECURE_COOKIES === "true";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  useSecureCookies,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = (user as { id?: string }).id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = String(token.id);
      }
      return session;
    },
  },
};
